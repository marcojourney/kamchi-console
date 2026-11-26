import * as ed25519 from '@noble/ed25519';
import type {
  BindingMode,
  LicenseBilling,
  LicensePlan,
  OfflineSelfVerifyResult,
} from '../types/license';

// =============================================================================
// KamChi Offline Ed25519 License Constants (Byte-for-Byte Contract)
// =============================================================================
export const LICENSE_EPOCH_UTC_MS = Date.UTC(2024, 0, 1); // 2024-01-01T00:00:00.000Z
export const MS_PER_DAY = 86_400_000;
export const LICENSE_VERSION = 1;
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const PLAN_TO_BYTE: Record<LicensePlan, number> = {
  pro: 1,
  business: 2,
};

export const BYTE_TO_PLAN: Record<number, LicensePlan> = {
  1: 'pro',
  2: 'business',
};

export const BILLING_TO_BYTE: Record<LicenseBilling, number> = {
  monthly: 1,
  yearly: 2,
  lifetime: 3,
};

export const BYTE_TO_BILLING: Record<number, LicenseBilling> = {
  1: 'monthly',
  2: 'yearly',
  3: 'lifetime',
};

export const DEVICE_CODE_REGEX = /^[A-Z2-7]{5}-[A-Z2-7]{5}$/;

// =============================================================================
// Byte / Hex / Base32 Helpers
// =============================================================================
export function bytesToHex(bytes: Uint8Array, uppercase = false): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return uppercase ? hex.toUpperCase() : hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Invalid hex string.');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function encodeBase32Unpadded(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function decodeBase32Unpadded(input: string): Uint8Array {
  const clean = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character "${clean[i]}".`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function formatKc1Key(base32Str: string): string {
  const groups: string[] = [];
  for (let i = 0; i < base32Str.length; i += 5) {
    groups.push(base32Str.slice(i, i + 5));
  }
  return `KC1-${groups.join('-')}`;
}

export function maskKc1Key(kc1Key: string): string {
  const parts = kc1Key.split('-');
  if (parts.length < 4) return 'KC1-****';
  return `${parts[0]}-${parts[1]}-*****-...-${parts[parts.length - 1]}`;
}

export function parseKc1KeyBytes(kc1Key: string): Uint8Array {
  const trimmed = kc1Key.trim().toUpperCase();
  if (!trimmed.startsWith('KC1-')) {
    throw new Error('License key must start with KC1-.');
  }
  const body = trimmed.slice(4).replace(/[-\s]+/g, '');
  if (body.length !== 144) {
    throw new Error(`Expected 144 Base32 characters after KC1-, got ${body.length}.`);
  }
  const decoded = decodeBase32Unpadded(body);
  if (decoded.length !== 90) {
    throw new Error(`Expected 90 decoded bytes, got ${decoded.length}.`);
  }
  return decoded;
}

// =============================================================================
// Epoch Day Math
// =============================================================================
export function epochMsToDayNumber(epochMs: number): number {
  return Math.floor((epochMs - LICENSE_EPOCH_UTC_MS) / MS_PER_DAY);
}

export function dayNumberToIso(dayNumber: number): string {
  return new Date(LICENSE_EPOCH_UTC_MS + dayNumber * MS_PER_DAY).toISOString();
}

// =============================================================================
// Device Code Validation & Hashing
// =============================================================================
export function normalizeDeviceCode(raw: string): string {
  const strippedSpaces = raw.replace(/\s+/g, '').toUpperCase();
  // Also conveniently insert dash if user pasted 10 raw Base32 chars without dash
  if (/^[A-Z2-7]{10}$/.test(strippedSpaces)) {
    return `${strippedSpaces.slice(0, 5)}-${strippedSpaces.slice(5, 10)}`;
  }
  return strippedSpaces;
}

export function validateDeviceCode(raw: string): { valid: boolean; normalized: string } {
  const strippedSpaces = raw.replace(/\s+/g, '').toUpperCase();
  return {
    valid: DEVICE_CODE_REGEX.test(strippedSpaces),
    normalized: strippedSpaces,
  };
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return new Uint8Array(digest);
}

export async function computeDeviceCodeHash(deviceCode?: string | null): Promise<Uint8Array> {
  if (!deviceCode || !deviceCode.trim()) {
    return new Uint8Array(8);
  }
  const stripped = deviceCode.replace(/[\s-]+/g, '').toUpperCase();
  const encoded = new TextEncoder().encode(stripped);
  const digest = await sha256(encoded);
  return digest.slice(0, 8);
}

// =============================================================================
// Ed25519 Keypair Generation & Import Validation
// =============================================================================
export async function generateEd25519Keypair(): Promise<{
  privateKeyHex: string;
  publicKeyHex: string;
}> {
  const secretKey = ed25519.utils.randomSecretKey();
  const publicKey = await ed25519.getPublicKeyAsync(secretKey);
  return {
    privateKeyHex: bytesToHex(secretKey),
    publicKeyHex: bytesToHex(publicKey),
  };
}

export async function derivePublicKeyFromPrivateHex(privateKeyHex: string): Promise<{
  privateKeyBytes: Uint8Array;
  publicKeyBytes: Uint8Array;
  publicKeyHex: string;
}> {
  const clean = privateKeyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error('Private key must be exactly 64 hexadecimal characters (32 bytes).');
  }
  const privateKeyBytes = hexToBytes(clean);
  const publicKeyBytes = await ed25519.getPublicKeyAsync(privateKeyBytes);
  return {
    privateKeyBytes,
    publicKeyBytes,
    publicKeyHex: bytesToHex(publicKeyBytes),
  };
}

// =============================================================================
// Binary Payload Builder, Signer & .kamchi-license Formatter
// =============================================================================
export interface GenerateOfflineLicenseParams {
  privateKeyHex: string;
  plan: LicensePlan;
  billing: LicenseBilling;
  issuedAtMs?: number;
  durationDays?: number;
  customExpiresAtMs?: number | null;
  maxDevices?: number;
  bindingMode: BindingMode;
  deviceCode?: string;
  keyIdBytes?: Uint8Array;
}

export interface GeneratedOfflineLicense {
  plainKey: string;
  maskedKey: string;
  keyIdHex: string;
  publicKeyHex: string;
  payload: Uint8Array;
  signature: Uint8Array;
  checksum: Uint8Array;
  fullBytes: Uint8Array;
  issuedAtDay: number;
  expiresAtDay: number;
  issuedAtIso: string;
  expiresAtIso: string | null;
  maxDevices: number;
  bindingMode: BindingMode;
  normalizedDeviceCode: string | null;
  deviceCodeHashHex: string;
  kamchiLicenseFileName: string;
  kamchiLicenseFileContent: string;
}

export async function generateOfflineLicense(
  params: GenerateOfflineLicenseParams
): Promise<GeneratedOfflineLicense> {
  const { privateKeyBytes, publicKeyHex } = await derivePublicKeyFromPrivateHex(params.privateKeyHex);

  const planByte = PLAN_TO_BYTE[params.plan];
  if (!planByte) throw new Error('Plan must be pro or business.');

  const billingByte = BILLING_TO_BYTE[params.billing];
  if (!billingByte) throw new Error('Billing must be monthly, yearly, or lifetime.');

  const maxDevices = params.maxDevices ?? 1;
  if (!Number.isInteger(maxDevices) || maxDevices < 1 || maxDevices > 255) {
    throw new Error('Max Devices must be an integer between 1 and 255.');
  }

  const issuedAtMs = params.issuedAtMs ?? Date.now();
  const issuedAtDay = epochMsToDayNumber(issuedAtMs);
  if (issuedAtDay < 0) {
    throw new Error('Issued date cannot be earlier than 2024-01-01 UTC.');
  }

  let expiresAtDay = 0;
  let expiresAtIso: string | null = null;
  if (params.billing !== 'lifetime') {
    if (typeof params.customExpiresAtMs === 'number') {
      expiresAtDay = epochMsToDayNumber(params.customExpiresAtMs);
    } else {
      const defaultDays = params.billing === 'monthly' ? 30 : 365;
      const days = params.durationDays ?? defaultDays;
      if (!Number.isInteger(days) || days < 1 || days > 36500) {
        throw new Error('Duration days must be a positive integer.');
      }
      expiresAtDay = issuedAtDay + days;
    }
    if (expiresAtDay <= issuedAtDay) {
      throw new Error('Expiration date must be after the issued date.');
    }
    expiresAtIso = dayNumberToIso(expiresAtDay);
  }

  let normalizedDeviceCode: string | null = null;
  let deviceCodeHash: Uint8Array;
  if (params.bindingMode === 'bound') {
    const check = validateDeviceCode(params.deviceCode ?? '');
    if (!check.valid) {
      throw new Error('Device Code must match ABCDE-FGHIJ (Base32 characters A-Z, 2-7).');
    }
    normalizedDeviceCode = check.normalized;
    deviceCodeHash = await computeDeviceCodeHash(normalizedDeviceCode);
  } else {
    deviceCodeHash = new Uint8Array(8);
  }

  const keyIdBytes = params.keyIdBytes
    ? new Uint8Array(params.keyIdBytes)
    : crypto.getRandomValues(new Uint8Array(4));
  if (keyIdBytes.length !== 4) {
    throw new Error('keyId must be exactly 4 bytes.');
  }
  const keyIdHex = bytesToHex(keyIdBytes, true);

  // Build exact 24-byte big-endian payload
  const payload = new Uint8Array(24);
  const view = new DataView(payload.buffer);
  view.setUint8(0, LICENSE_VERSION);
  view.setUint8(1, planByte);
  view.setUint8(2, billingByte);
  view.setUint32(3, issuedAtDay, false);
  view.setUint32(7, expiresAtDay, false);
  view.setUint8(11, maxDevices);
  payload.set(deviceCodeHash, 12);
  payload.set(keyIdBytes, 20);

  // Sign raw 24-byte payload with Ed25519
  const signature = await ed25519.signAsync(payload, privateKeyBytes);
  if (signature.length !== 64) {
    throw new Error('Unexpected Ed25519 signature length.');
  }

  // combined = payload (24B) || signature (64B) = 88B
  const combined = new Uint8Array(88);
  combined.set(payload, 0);
  combined.set(signature, 24);

  // checksum = SHA-256(combined).slice(0, 2)
  const checksum = (await sha256(combined)).slice(0, 2);

  // full = combined (88B) || checksum (2B) = 90B
  const fullBytes = new Uint8Array(90);
  fullBytes.set(combined, 0);
  fullBytes.set(checksum, 88);

  const base32 = encodeBase32Unpadded(fullBytes);
  const plainKey = formatKc1Key(base32);
  const maskedKey = maskKc1Key(plainKey);
  const issuedAtIso = dayNumberToIso(issuedAtDay);

  const fileLines = [
    `# KamChi Offline License`,
    `# Plan: ${params.plan}`,
    `# Billing: ${params.billing}`,
    `# Expiry: ${expiresAtIso ? expiresAtIso.slice(0, 10) : 'lifetime'}`,
    `# Key ID: ${keyIdHex}`,
    `# Binding: ${normalizedDeviceCode ? `Device-bound (${normalizedDeviceCode})` : 'Unbound'}`,
    plainKey,
    '',
  ];

  return {
    plainKey,
    maskedKey,
    keyIdHex,
    publicKeyHex,
    payload,
    signature,
    checksum,
    fullBytes,
    issuedAtDay,
    expiresAtDay,
    issuedAtIso,
    expiresAtIso,
    maxDevices,
    bindingMode: params.bindingMode,
    normalizedDeviceCode,
    deviceCodeHashHex: bytesToHex(deviceCodeHash),
    kamchiLicenseFileName: `${keyIdHex}-${params.plan}.kamchi-license`,
    kamchiLicenseFileContent: fileLines.join('\n'),
  };
}

// =============================================================================
// Decoder & Self-Verification (Mirrors KamChi PWA Verifier)
// =============================================================================
export interface DecodedOfflineLicense {
  version: number;
  plan: LicensePlan;
  billing: LicenseBilling;
  issuedAtDay: number;
  expiresAtDay: number;
  issuedAtIso: string;
  expiresAtIso: string | null;
  maxDevices: number;
  deviceCodeHash: Uint8Array;
  deviceCodeHashHex: string;
  keyIdHex: string;
  payload: Uint8Array;
  signature: Uint8Array;
  checksum: Uint8Array;
}

export function decodeOfflineLicensePayload(fullBytes: Uint8Array): DecodedOfflineLicense {
  if (fullBytes.length !== 90) {
    throw new Error('License payload must be 90 bytes.');
  }
  const payload = fullBytes.slice(0, 24);
  const signature = fullBytes.slice(24, 88);
  const checksum = fullBytes.slice(88, 90);

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const version = view.getUint8(0);
  const planByte = view.getUint8(1);
  const billingByte = view.getUint8(2);
  const issuedAtDay = view.getUint32(3, false);
  const expiresAtDay = view.getUint32(7, false);
  const maxDevices = view.getUint8(11);
  const deviceCodeHash = payload.slice(12, 20);
  const keyId = payload.slice(20, 24);

  const plan = BYTE_TO_PLAN[planByte];
  const billing = BYTE_TO_BILLING[billingByte];
  if (!plan || !billing) {
    throw new Error(`Invalid plan (${planByte}) or billing (${billingByte}) byte.`);
  }

  return {
    version,
    plan,
    billing,
    issuedAtDay,
    expiresAtDay,
    issuedAtIso: dayNumberToIso(issuedAtDay),
    expiresAtIso: expiresAtDay === 0 ? null : dayNumberToIso(expiresAtDay),
    maxDevices,
    deviceCodeHash,
    deviceCodeHashHex: bytesToHex(deviceCodeHash),
    keyIdHex: bytesToHex(keyId, true),
    payload,
    signature,
    checksum,
  };
}

export async function verifyOfflineLicense(params: {
  kc1Key: string;
  publicKeyHex: string;
  expectedDeviceCode?: string | null;
}): Promise<OfflineSelfVerifyResult & { decoded?: DecodedOfflineLicense }> {
  try {
    const fullBytes = parseKc1KeyBytes(params.kc1Key);
    const combined = fullBytes.slice(0, 88);
    const actualChecksum = fullBytes.slice(88, 90);
    const expectedChecksum = (await sha256(combined)).slice(0, 2);

    const checksumValid =
      actualChecksum[0] === expectedChecksum[0] && actualChecksum[1] === expectedChecksum[1];

    const decoded = decodeOfflineLicensePayload(fullBytes);
    const publicKeyBytes = hexToBytes(params.publicKeyHex);
    const signatureValid = await ed25519.verifyAsync(
      decoded.signature,
      decoded.payload,
      publicKeyBytes
    );

    const expectedDeviceHash = await computeDeviceCodeHash(params.expectedDeviceCode ?? null);
    const deviceCodeHashMatches = expectedDeviceHash.every(
      (b, idx) => b === decoded.deviceCodeHash[idx]
    );

    const valid =
      checksumValid &&
      signatureValid &&
      deviceCodeHashMatches &&
      decoded.version === LICENSE_VERSION;

    return {
      valid,
      checksumValid,
      signatureValid,
      deviceCodeHashMatches,
      payloadVersion: decoded.version,
      decoded,
    };
  } catch (err) {
    return {
      valid: false,
      checksumValid: false,
      signatureValid: false,
      deviceCodeHashMatches: false,
      payloadVersion: 0,
      error: err instanceof Error ? err.message : 'Verification failed.',
    };
  }
}
