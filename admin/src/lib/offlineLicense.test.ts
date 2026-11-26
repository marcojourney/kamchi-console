import { createHash } from 'node:crypto';
import * as ed25519 from '@noble/ed25519';
import { describe, expect, it } from 'vitest';
import {
  BASE32_ALPHABET,
  LICENSE_EPOCH_UTC_MS,
  MS_PER_DAY,
  computeDeviceCodeHash,
  decodeBase32Unpadded,
  decodeOfflineLicensePayload,
  derivePublicKeyFromPrivateHex,
  encodeBase32Unpadded,
  epochMsToDayNumber,
  generateEd25519Keypair,
  generateOfflineLicense,
  parseKc1KeyBytes,
  validateDeviceCode,
  verifyOfflineLicense,
} from './offlineLicense';

describe('KamChi Offline Ed25519 KC1 License Cryptographic Spec', () => {
  it('computes dayNumber from 2024-01-01T00:00:00.000Z UTC epoch', () => {
    expect(LICENSE_EPOCH_UTC_MS).toBe(Date.UTC(2024, 0, 1));
    expect(MS_PER_DAY).toBe(86_400_000);
    expect(epochMsToDayNumber(Date.UTC(2024, 0, 1, 0, 0, 0))).toBe(0);
    expect(epochMsToDayNumber(Date.UTC(2024, 0, 1, 23, 59, 59))).toBe(0);
    expect(epochMsToDayNumber(Date.UTC(2024, 0, 2, 0, 0, 0))).toBe(1);
    expect(epochMsToDayNumber(Date.UTC(2026, 10, 25, 12, 0, 0))).toBe(1059);
  });

  it('validates Device Codes and computes exact 8-byte SHA-256 deviceCodeHash', async () => {
    expect(validateDeviceCode(' abcde - fghij ').valid).toBe(true);
    expect(validateDeviceCode('abcde-fghij').normalized).toBe('ABCDE-FGHIJ');
    expect(validateDeviceCode('ABC1E-FGHIJ').valid).toBe(false); // 1 is not RFC 4648 Base32
    expect(validateDeviceCode('ABC8E-FGHIJ').valid).toBe(false); // 8 is not RFC 4648 Base32

    const unboundHash = await computeDeviceCodeHash(null);
    expect(unboundHash).toEqual(new Uint8Array(8));

    const boundHash = await computeDeviceCodeHash(' abcde-fghij ');
    const nodeDigest = createHash('sha256').update('ABCDEFGHIJ', 'utf8').digest();
    expect(boundHash).toEqual(new Uint8Array(nodeDigest.subarray(0, 8)));
  });

  it('builds exact 24-byte big-endian payload, 64B Ed25519 signature over payload, 2B SHA-256 checksum, and 144-char KC1 Base32', async () => {
    const pair = await generateEd25519Keypair();
    expect(pair.privateKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(pair.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);

    const derived = await derivePublicKeyFromPrivateHex(pair.privateKeyHex);
    expect(derived.publicKeyHex).toBe(pair.publicKeyHex);

    const issuedAtMs = Date.UTC(2026, 10, 25, 8, 30, 0);
    const keyIdBytes = new Uint8Array([0xa1, 0xb2, 0xc3, 0xd4]);

    const res = await generateOfflineLicense({
      privateKeyHex: pair.privateKeyHex,
      plan: 'business',
      billing: 'yearly',
      issuedAtMs,
      durationDays: 365,
      maxDevices: 5,
      bindingMode: 'bound',
      deviceCode: 'ABCDE-FGHIJ',
      keyIdBytes,
    });

    // Check total byte sizes
    expect(res.payload.length).toBe(24);
    expect(res.signature.length).toBe(64);
    expect(res.checksum.length).toBe(2);
    expect(res.fullBytes.length).toBe(90);

    // Check 24-byte big-endian layout
    const view = new DataView(res.payload.buffer);
    expect(view.getUint8(0)).toBe(1); // version = 1
    expect(view.getUint8(1)).toBe(2); // plan = business (2)
    expect(view.getUint8(2)).toBe(2); // billing = yearly (2)
    expect(view.getUint32(3, false)).toBe(epochMsToDayNumber(issuedAtMs));
    expect(view.getUint32(7, false)).toBe(epochMsToDayNumber(issuedAtMs) + 365);
    expect(view.getUint8(11)).toBe(5); // maxDevices
    expect(res.payload.slice(12, 20)).toEqual(await computeDeviceCodeHash('ABCDE-FGHIJ'));
    expect(res.payload.slice(20, 24)).toEqual(keyIdBytes);
    expect(res.keyIdHex).toBe('A1B2C3D4');

    // Verify Ed25519 signature was computed strictly over the 24-byte raw payload
    const directVerify = await ed25519.verifyAsync(
      res.signature,
      res.payload,
      derived.publicKeyBytes
    );
    expect(directVerify).toBe(true);

    // Verify 2-byte checksum over 88-byte combined (payload || signature)
    const expectedCombined = new Uint8Array(88);
    expectedCombined.set(res.payload, 0);
    expectedCombined.set(res.signature, 24);
    const expectedChecksum = new Uint8Array(
      createHash('sha256').update(expectedCombined).digest().subarray(0, 2)
    );
    expect(res.checksum).toEqual(expectedChecksum);

    // Verify KC1- formatting (144 unpadded Base32 chars -> 28 groups of 5 + 1 group of 4)
    expect(res.plainKey.startsWith('KC1-')).toBe(true);
    const groups = res.plainKey.slice(4).split('-');
    expect(groups).toHaveLength(29);
    expect(groups.slice(0, 28).every((g) => g.length === 5)).toBe(true);
    expect(groups[28].length).toBe(4);
    const rawBase32 = groups.join('');
    expect(rawBase32.length).toBe(144);
    expect([...rawBase32].every((ch) => BASE32_ALPHABET.includes(ch))).toBe(true);
    expect(encodeBase32Unpadded(res.fullBytes)).toBe(rawBase32);
    expect(decodeBase32Unpadded(rawBase32)).toEqual(res.fullBytes);
    expect(parseKc1KeyBytes(res.plainKey)).toEqual(res.fullBytes);

    // Verify .kamchi-license filename and contents
    expect(res.kamchiLicenseFileName).toBe('A1B2C3D4-business.kamchi-license');
    expect(res.kamchiLicenseFileContent).toContain('# Plan: business');
    expect(res.kamchiLicenseFileContent).toContain('# Key ID: A1B2C3D4');
    expect(res.kamchiLicenseFileContent).toContain(`\n${res.plainKey}\n`);

    // Full verifier round-trip
    const verified = await verifyOfflineLicense({
      kc1Key: res.plainKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: 'ABCDE-FGHIJ',
    });
    expect(verified.valid).toBe(true);
    expect(verified.checksumValid).toBe(true);
    expect(verified.signatureValid).toBe(true);
    expect(verified.deviceCodeHashMatches).toBe(true);
    expect(verified.payloadVersion).toBe(1);
    expect(verified.decoded?.plan).toBe('business');
    expect(verified.decoded?.billing).toBe('yearly');
    expect(verified.decoded?.maxDevices).toBe(5);
  });

  it('encodes lifetime as expiresAtDay = 0 and unbound deviceCodeHash as 8 zero bytes', async () => {
    const pair = await generateEd25519Keypair();
    const res = await generateOfflineLicense({
      privateKeyHex: pair.privateKeyHex,
      plan: 'pro',
      billing: 'lifetime',
      issuedAtMs: Date.UTC(2026, 10, 25),
      maxDevices: 1,
      bindingMode: 'unbound',
    });

    const decoded = decodeOfflineLicensePayload(res.fullBytes);
    expect(decoded.plan).toBe('pro');
    expect(decoded.billing).toBe('lifetime');
    expect(decoded.expiresAtDay).toBe(0);
    expect(decoded.expiresAtIso).toBeNull();
    expect(decoded.deviceCodeHash).toEqual(new Uint8Array(8));

    const verified = await verifyOfflineLicense({
      kc1Key: res.plainKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: null,
    });
    expect(verified.valid).toBe(true);
    expect(verified.deviceCodeHashMatches).toBe(true);
  });

  it('detects checksum tampering, wrong public key, and mismatched Device Code', async () => {
    const pair = await generateEd25519Keypair();
    const otherPair = await generateEd25519Keypair();

    const res = await generateOfflineLicense({
      privateKeyHex: pair.privateKeyHex,
      plan: 'pro',
      billing: 'monthly',
      issuedAtMs: Date.UTC(2026, 10, 25),
      bindingMode: 'bound',
      deviceCode: 'ABCDE-FGHIJ',
    });

    // 1. Flip the last character of the key to corrupt the 2-byte checksum
    const lastChar = res.plainKey.slice(-1);
    const replacementChar = lastChar === 'A' ? 'B' : 'A';
    const tamperedKey = `${res.plainKey.slice(0, -1)}${replacementChar}`;
    const tamperedResult = await verifyOfflineLicense({
      kc1Key: tamperedKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: 'ABCDE-FGHIJ',
    });
    expect(tamperedResult.valid).toBe(false);
    expect(tamperedResult.checksumValid).toBe(false);

    // 2. Wrong public key
    const wrongPubResult = await verifyOfflineLicense({
      kc1Key: res.plainKey,
      publicKeyHex: otherPair.publicKeyHex,
      expectedDeviceCode: 'ABCDE-FGHIJ',
    });
    expect(wrongPubResult.valid).toBe(false);
    expect(wrongPubResult.checksumValid).toBe(true);
    expect(wrongPubResult.signatureValid).toBe(false);

    // 3. Mismatched Device Code
    const wrongDeviceResult = await verifyOfflineLicense({
      kc1Key: res.plainKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: 'ZZZZZ-ZZZZZ',
    });
    expect(wrongDeviceResult.valid).toBe(false);
    expect(wrongDeviceResult.signatureValid).toBe(true);
    expect(wrongDeviceResult.deviceCodeHashMatches).toBe(false);
  });
});
