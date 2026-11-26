import { describe, expect, it } from 'vitest';
import { LocalLicenseStore, type StorageLike } from './localLicenseStore';
import { hashLicenseKeyBrowser, validateLicenseKeyChecksum } from './licenseKeyBrowser';

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

describe('LocalLicenseStore (browser localStorage mode)', () => {
  it('generates valid keys, stores only HMAC-SHA256 hash, and returns EN/KM Telegram text', async () => {
    const store = new LocalLicenseStore(createMemoryStorage());
    const created = await store.createLicense({
      plan: 'pro',
      billing: 'yearly',
      buyerContact: '@sokha',
      notes: 'ABA #12345',
    });

    expect(created.plainKey).toMatch(/^KAMCHI-PRO-/);
    expect(validateLicenseKeyChecksum(created.plainKey).valid).toBe(true);
    expect(created.license.maxDevices).toBe(2);
    expect(created.telegramMessages.en).toContain(created.plainKey);
    expect(created.telegramMessages.km).toContain(created.plainKey);

    const expectedHash = await hashLicenseKeyBrowser(created.plainKey, store.getPepper());
    expect(created.keyHash).toBe(expectedHash);

    const listed = await store.listLicenses({ query: '@sokha' });
    expect(listed.items).toHaveLength(1);
    expect(JSON.stringify(listed.items[0])).not.toContain(created.plainKey);
  });

  it('supports extend, revoke, reinstate, reissue, CSV export, and JSON backup import', async () => {
    const store = new LocalLicenseStore(createMemoryStorage());
    const t0 = Date.parse('2026-11-25T10:00:00.000Z');
    const created = await store.createLicense(
      { plan: 'business', billing: 'monthly', buyerContact: '012999888' },
      t0
    );

    const extended = await store.extendLicense({ keyHash: created.keyHash, addDays: 30 }, t0);
    expect(Date.parse(extended.license.expiresAt!)).toBe(t0 + 60 * 24 * 60 * 60 * 1000);

    const reissued = await store.reissueLicense({ keyHash: created.keyHash }, t0 + 1000);
    expect(reissued.newKeyHash).not.toBe(created.keyHash);
    expect((await store.getLicense(created.keyHash)).license.status).toBe('revoked');

    const { csv, count } = await store.exportLicensesCsv({});
    expect(count).toBe(2);
    expect(csv).not.toContain(created.plainKey);
    expect(csv).not.toContain(reissued.plainKey);

    const backup = store.exportBackupJson();
    const secondStore = new LocalLicenseStore(createMemoryStorage());
    const imported = secondStore.importBackupJson(backup);
    expect(imported.licenseCount).toBe(2);
    expect((await secondStore.listLicenses({})).items).toHaveLength(2);
  });
});
