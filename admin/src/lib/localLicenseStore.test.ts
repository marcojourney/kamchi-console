import { describe, expect, it } from 'vitest';
import { LocalLicenseStore, type StorageLike } from './localLicenseStore';
import { verifyOfflineLicense } from './offlineLicense';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

describe('LocalLicenseStore (Ed25519 Offline KC1 Vault & Log)', () => {
  it('requires a configured signing key, generates KC1 keys with self-verification, and masks stored logs', async () => {
    const store = new LocalLicenseStore(createMemoryStorage());

    expect(store.getSigningKeyStatus().hasKey).toBe(false);
    await expect(
      store.createLicense({
        plan: 'pro',
        billing: 'yearly',
        bindingMode: 'unbound',
      })
    ).rejects.toThrow(/No Ed25519 signing key loaded/);

    const pair = await store.generateNewSigningKeypair(true);
    expect(store.getSigningKeyStatus().hasKey).toBe(true);
    expect(store.getSigningKeyStatus().publicKeyHex).toBe(pair.publicKeyHex);

    const created = await store.createLicense({
      plan: 'pro',
      billing: 'yearly',
      maxDevices: 1,
      bindingMode: 'bound',
      deviceCode: 'ABCDE-FGHIJ',
      buyerContact: '@sokha',
      notes: 'ABA #12345',
    });

    expect(created.plainKey).toMatch(/^KC1-/);
    expect(created.keyIdHex).toMatch(/^[0-9A-F]{8}$/);
    expect(created.selfVerify.valid).toBe(true);
    expect(created.kamchiLicenseFileName).toBe(`${created.keyIdHex}-pro.kamchi-license`);
    expect(created.telegramMessages.en).toContain(created.plainKey);
    expect(created.telegramMessages.km).toContain(created.plainKey);

    const verified = await verifyOfflineLicense({
      kc1Key: created.plainKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: 'ABCDE-FGHIJ',
    });
    expect(verified.valid).toBe(true);

    const listed = await store.listLicenses({ query: '@sokha' });
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed.items[0])).not.toContain(created.plainKey);
  });

  it('supports renew, reissue to a new phone Device Code, revoke/reinstate, CSV export, and safe JSON backup', async () => {
    const store = new LocalLicenseStore(createMemoryStorage());
    const pair = await store.generateNewSigningKeypair(true);
    const t0 = Date.UTC(2026, 10, 25, 10, 0, 0);

    const created = await store.createLicense(
      {
        plan: 'business',
        billing: 'monthly',
        durationDays: 30,
        bindingMode: 'bound',
        deviceCode: 'ABCDE-FGHIJ',
        buyerContact: '012999888',
      },
      t0
    );

    // Renew with yearly billing
    const renewed = await store.renewLicense(
      { keyIdHex: created.keyIdHex, billing: 'yearly', durationDays: 365 },
      t0 + 1000
    );
    expect(renewed.newKeyIdHex).not.toBe(created.keyIdHex);
    expect(renewed.selfVerify.valid).toBe(true);
    expect((await store.getLicense(created.keyIdHex)).license.status).toBe('revoked');

    // Reissue to a new Device Code (buyer switched phone)
    const reissued = await store.reissueLicense(
      {
        keyIdHex: renewed.newKeyIdHex,
        bindingMode: 'bound',
        deviceCode: 'KLMNP-QRSTU',
        reason: 'Buyer switched to new phone',
      },
      t0 + 2000
    );
    expect(reissued.license.deviceCode).toBe('KLMNP-QRSTU');
    expect(reissued.selfVerify.valid).toBe(true);
    expect((await store.getLicense(renewed.newKeyIdHex)).license.status).toBe('revoked');

    const verifiedNewPhone = await verifyOfflineLicense({
      kc1Key: reissued.plainKey,
      publicKeyHex: pair.publicKeyHex,
      expectedDeviceCode: 'KLMNP-QRSTU',
    });
    expect(verifiedNewPhone.valid).toBe(true);

    // CSV export must never include plain KC1 keys
    const { csv, count } = await store.exportLicensesCsv({});
    expect(count).toBe(3);
    expect(csv).not.toContain(created.plainKey);
    expect(csv).not.toContain(renewed.plainKey);
    expect(csv).not.toContain(reissued.plainKey);

    // JSON backup must exclude private signing key
    const backup = store.exportBackupJson();
    expect(backup).not.toContain(pair.privateKeyHex);

    const secondStore = new LocalLicenseStore(createMemoryStorage());
    const imported = secondStore.importBackupJson(backup);
    expect(imported.licenseCount).toBe(3);
    expect((await secondStore.listLicenses({})).items).toHaveLength(3);
    expect(secondStore.getSigningKeyStatus().hasKey).toBe(false);
  });
});
