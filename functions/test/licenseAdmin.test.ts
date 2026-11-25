import { describe, expect, it } from 'vitest';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  changePlanHandler,
  createLicenseHandler,
  expireOverdueLicensesHandler,
  exportLicensesCsvHandler,
  extendLicenseHandler,
  getDashboardSummaryHandler,
  getLicenseHandler,
  listAuditLogsHandler,
  listLicensesHandler,
  reissueLicenseHandler,
  reinstateLicenseHandler,
  removeDeviceHandler,
  resetDevicesHandler,
  revokeLicenseHandler,
  type HandlerContext,
} from '../src/lib/adminHandlers.js';
import {
  DEFAULT_MAX_DEVICES,
  LICENSE_ALPHABET,
  generateLicenseKey,
  hashLicenseKey,
  normalizeLicenseKey,
  validateLicenseKeyChecksum,
} from '../src/lib/licenseKey.js';
import { checkRateLimit } from '../src/lib/security.js';

// =============================================================================
// Lightweight In-Memory Firestore Mock for Deterministic Unit Testing
// =============================================================================
class FakeTimestamp {
  constructor(private readonly ms: number) {}
  toMillis() {
    return this.ms;
  }
  toDate() {
    return new Date(this.ms);
  }
}

const makeTimestamp = (ms: number) => new FakeTimestamp(ms) as unknown as Timestamp;

function cloneValue<T>(val: T): T {
  if (val instanceof FakeTimestamp) {
    return new FakeTimestamp(val.toMillis()) as unknown as T;
  }
  if (Array.isArray(val)) {
    return val.map((item) => cloneValue(item)) as unknown as T;
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = cloneValue(v);
    }
    return out as T;
  }
  return val;
}

function createFakeFirestore() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  let autoId = 1;

  const ensureCollection = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  const makeDocRef = (colName: string, id: string) => ({
    id,
    path: `${colName}/${id}`,
    get: async () => {
      const data = ensureCollection(colName).get(id);
      return {
        id,
        exists: Boolean(data),
        data: () => (data ? cloneValue(data) : undefined),
        ref: makeDocRef(colName, id),
      };
    },
    set: async (data: Record<string, unknown>) => {
      ensureCollection(colName).set(id, cloneValue(data));
    },
    update: async (patch: Record<string, unknown>) => {
      const col = ensureCollection(colName);
      const prev = col.get(id);
      if (!prev) throw new Error(`Document ${colName}/${id} does not exist`);
      col.set(id, { ...prev, ...cloneValue(patch) });
    },
  });

  const makeQuery = (
    colName: string,
    filters: Array<{ field: string; op: string; value: unknown }> = [],
    orderField?: string,
    orderDir: 'asc' | 'desc' = 'asc',
    afterId?: string,
    limitCount?: number
  ) => ({
    where(field: string, op: string, value: unknown) {
      return makeQuery(colName, [...filters, { field, op, value }], orderField, orderDir, afterId, limitCount);
    },
    orderBy(field: string, dir: 'asc' | 'desc' = 'asc') {
      return makeQuery(colName, filters, field, dir, afterId, limitCount);
    },
    startAfter(snap: { id: string }) {
      return makeQuery(colName, filters, orderField, orderDir, snap.id, limitCount);
    },
    limit(n: number) {
      return makeQuery(colName, filters, orderField, orderDir, afterId, n);
    },
    async get() {
      const entries = Array.from(ensureCollection(colName).entries()).filter(([, doc]) =>
        filters.every(({ field, op, value }) => {
          const val = doc[field];
          const valNorm = val && typeof (val as FakeTimestamp).toMillis === 'function' ? (val as FakeTimestamp).toMillis() : val;
          const targetNorm =
            value && typeof (value as FakeTimestamp).toMillis === 'function'
              ? (value as FakeTimestamp).toMillis()
              : value;
          if (op === '==') return valNorm === targetNorm;
          if (op === '<=') return valNorm !== null && valNorm !== undefined && (valNorm as number) <= (targetNorm as number);
          return true;
        })
      );

      if (orderField) {
        entries.sort(([, a], [, b]) => {
          const av = a[orderField];
          const bv = b[orderField];
          const am = av && typeof (av as FakeTimestamp).toMillis === 'function' ? (av as FakeTimestamp).toMillis() : Number(av ?? 0);
          const bm = bv && typeof (bv as FakeTimestamp).toMillis === 'function' ? (bv as FakeTimestamp).toMillis() : Number(bv ?? 0);
          return orderDir === 'desc' ? bm - am : am - bm;
        });
      }

      let sliced = entries;
      if (afterId) {
        const idx = entries.findIndex(([id]) => id === afterId);
        if (idx >= 0) sliced = entries.slice(idx + 1);
      }
      if (typeof limitCount === 'number') {
        sliced = sliced.slice(0, limitCount);
      }

      return {
        docs: sliced.map(([id, doc]) => ({
          id,
          exists: true,
          data: () => cloneValue(doc),
          ref: makeDocRef(colName, id),
        })),
      };
    },
  });

  const db = {
    collection: (name: string) => ({
      doc: (id: string) => makeDocRef(name, id),
      add: async (data: Record<string, unknown>) => {
        const id = `log_${autoId++}`;
        ensureCollection(name).set(id, cloneValue(data));
        return makeDocRef(name, id);
      },
      orderBy: (field: string, dir: 'asc' | 'desc' = 'asc') => makeQuery(name, [], field, dir),
      where: (field: string, op: string, value: unknown) => makeQuery(name, [{ field, op, value }]),
      limit: (n: number) => makeQuery(name, [], undefined, 'asc', undefined, n),
      get: () => makeQuery(name).get(),
    }),
    runTransaction: async <T>(fn: (tx: unknown) => Promise<T>) => {
      const tx = {
        get: (ref: ReturnType<typeof makeDocRef>) => ref.get(),
        set: (ref: ReturnType<typeof makeDocRef>, data: Record<string, unknown>) => ref.set(data),
        update: (ref: ReturnType<typeof makeDocRef>, patch: Record<string, unknown>) => ref.update(patch),
      };
      return fn(tx);
    },
    batch: () => {
      const ops: Array<() => Promise<void>> = [];
      return {
        update: (ref: ReturnType<typeof makeDocRef>, patch: Record<string, unknown>) => {
          ops.push(() => ref.update(patch));
        },
        commit: async () => {
          for (const op of ops) await op();
        },
      };
    },
  };

  return {
    db: db as unknown as Firestore,
    dump: (colName: string) => Array.from(ensureCollection(colName).entries()),
  };
}

const TEST_PEPPER = 'kamchi-test-pepper-super-secret-2026';
const BASE_TIME = Date.parse('2026-11-24T12:00:00.000Z');
const ADMIN_AUTH = {
  uid: 'admin-uid-1',
  token: { email: 'owner@kamchi.app', email_verified: true, admin: true },
};

function makeCtx(
  db: Firestore,
  overrides: Partial<HandlerContext> = {}
): HandlerContext {
  return {
    db,
    pepper: TEST_PEPPER,
    auth: ADMIN_AUTH,
    nowMs: BASE_TIME,
    makeTimestamp,
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================
describe('KamChi License Key Generation & Checksum', () => {
  it('generates valid unique keys in expected format and unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const proKey = generateLicenseKey('pro');
      expect(proKey).toMatch(/^KAMCHI-PRO-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
      expect(seen.has(proKey)).toBe(false);
      seen.add(proKey);

      const validation = validateLicenseKeyChecksum(proKey);
      expect(validation.valid).toBe(true);
      expect(validation.plan).toBe('pro');
    }

    const bizKey = generateLicenseKey('business');
    expect(bizKey).toMatch(/^KAMCHI-BIZ-/);
    expect(validateLicenseKeyChecksum(bizKey).plan).toBe('business');
    for (const ch of bizKey.replace(/^KAMCHI-(PRO|BIZ|FREE)-/, '').replace(/-/g, '')) {
      expect(LICENSE_ALPHABET).toContain(ch);
      expect('01ILO').not.toContain(ch);
    }
  });

  it('rejects tampered keys with invalid checksums and normalizes whitespace/case', () => {
    const key = generateLicenseKey('pro');
    const messy = `  ${key.toLowerCase().replace(/-/g, ' ')}  `;
    expect(normalizeLicenseKey(messy)).toBe(key);
    expect(validateLicenseKeyChecksum(messy).valid).toBe(true);
    expect(hashLicenseKey(messy, TEST_PEPPER)).toBe(hashLicenseKey(key, TEST_PEPPER));

    // Flip last character (checksum)
    const lastChar = key.slice(-1);
    const replacement = lastChar === '2' ? '3' : '2';
    const tampered = key.slice(0, -1) + replacement;
    expect(validateLicenseKeyChecksum(tampered).valid).toBe(false);
  });
});

describe('Server-Side Auth & Rate Limiting', () => {
  it('rejects unauthenticated, unverified, and non-admin callers', async () => {
    const { db } = createFakeFirestore();

    await expect(
      listLicensesHandler(makeCtx(db, { auth: null }), {})
    ).rejects.toMatchObject({ code: 'unauthenticated' });

    await expect(
      listLicensesHandler(
        makeCtx(db, { auth: { uid: 'u1', token: { email: 'a@b.com', email_verified: false, admin: true } } }),
        {}
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });

    await expect(
      createLicenseHandler(
        makeCtx(db, { auth: { uid: 'u2', token: { email: 'user@gmail.com', email_verified: true, admin: false } } }),
        { plan: 'pro', billing: 'monthly' }
      )
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('enforces per-admin rate limits', async () => {
    const { db } = createFakeFirestore();
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(db, 'admin-1', 'mint', BASE_TIME, { windowMs: 60_000, maxRequests: 3 }, makeTimestamp);
    }
    await expect(
      checkRateLimit(db, 'admin-1', 'mint', BASE_TIME + 1000, { windowMs: 60_000, maxRequests: 3 }, makeTimestamp)
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });
});

describe('License Lifecycle: Create, Extend, Revoke, Reinstate, Devices, Reissue, CSV, Expiry', () => {
  it('creates licenses with default maxDevices, stores only hash, and returns EN/KM Telegram copy', async () => {
    const { db, dump } = createFakeFirestore();
    const res = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'monthly',
      buyerContact: '@sokha_shop',
      notes: 'ABA #889900',
    });

    expect(res.plainKey).toMatch(/^KAMCHI-PRO-/);
    expect(res.license.maxDevices).toBe(DEFAULT_MAX_DEVICES.pro);
    expect(res.license.status).toBe('active');
    expect(res.telegramMessages.en).toContain(res.plainKey);
    expect(res.telegramMessages.km).toContain(res.plainKey);
    expect(res.telegramMessages.km).toContain('KamChi');

    const stored = dump('licenses');
    expect(stored).toHaveLength(1);
    expect(stored[0][0]).toBe(res.keyHash);
    expect(JSON.stringify(stored[0][1])).not.toContain(res.plainKey);

    const logs = dump('adminAuditLog');
    expect(logs).toHaveLength(1);
    expect(logs[0][1].action).toBe('createLicense');
    expect(logs[0][1].targetKeyHashPrefix).toBe(res.keyHashPrefix);
  });

  it('extends active and expired licenses accurately', async () => {
    const { db } = createFakeFirestore();
    const created = await createLicenseHandler(makeCtx(db), {
      plan: 'business',
      billing: 'monthly',
      buyerContact: '012345678',
    });

    expect(created.license.maxDevices).toBe(DEFAULT_MAX_DEVICES.business);
    const originalExpMs = Date.parse(created.license.expiresAt!);

    // Extend active license by 30 days from existing expiresAt
    const extended = await extendLicenseHandler(makeCtx(db), {
      keyHash: created.keyHash,
      addDays: 30,
    });
    expect(Date.parse(extended.license.expiresAt!)).toBe(originalExpMs + 30 * 24 * 60 * 60 * 1000);

    // Move clock past expiry, run expiry scheduler, then extend by 15 days from now
    const afterExpiry = originalExpMs + 35 * 24 * 60 * 60 * 1000;
    const expiredRun = await expireOverdueLicensesHandler({
      db,
      nowMs: afterExpiry,
      makeTimestamp,
    });
    expect(expiredRun.expiredCount).toBe(1);

    const reactivated = await extendLicenseHandler(makeCtx(db, { nowMs: afterExpiry }), {
      keyHash: created.keyHash,
      addDays: 15,
    });
    expect(reactivated.license.status).toBe('active');
    expect(Date.parse(reactivated.license.expiresAt!)).toBe(afterExpiry + 15 * 24 * 60 * 60 * 1000);
  });

  it('revokes, prevents extending revoked keys, reinstates, changes plan, and manages devices', async () => {
    const { db } = createFakeFirestore();
    const created = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'yearly',
      buyerContact: '@dara',
    });

    // Simulate mobile app registering two devices
    await db
      .collection('licenses')
      .doc(created.keyHash)
      .update({
        devices: [
          { deviceId: 'dev-1', label: 'iPhone 15', activatedAt: makeTimestamp(BASE_TIME), lastSeenAt: makeTimestamp(BASE_TIME) },
          { deviceId: 'dev-2', label: 'Galaxy S24', activatedAt: makeTimestamp(BASE_TIME), lastSeenAt: makeTimestamp(BASE_TIME) },
        ],
      });

    const removed = await removeDeviceHandler(makeCtx(db), { keyHash: created.keyHash, deviceId: 'dev-1' });
    expect(removed.license.devices).toHaveLength(1);
    expect(removed.license.devices[0].deviceId).toBe('dev-2');

    const reset = await resetDevicesHandler(makeCtx(db), { keyHash: created.keyHash });
    expect(reset.license.devices).toHaveLength(0);

    const upgraded = await changePlanHandler(makeCtx(db), { keyHash: created.keyHash, plan: 'business' });
    expect(upgraded.license.plan).toBe('business');
    expect(upgraded.license.maxDevices).toBe(5);

    const revoked = await revokeLicenseHandler(makeCtx(db), {
      keyHash: created.keyHash,
      reason: 'Chargeback requested',
    });
    expect(revoked.license.status).toBe('revoked');
    expect(revoked.license.revokedReason).toBe('Chargeback requested');

    await expect(
      extendLicenseHandler(makeCtx(db), { keyHash: created.keyHash, addDays: 10 })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const reinstated = await reinstateLicenseHandler(makeCtx(db), { keyHash: created.keyHash });
    expect(reinstated.license.status).toBe('active');
    expect(reinstated.license.revokedReason).toBeNull();
  });

  it('reissues a lost key by creating a new key and revoking the old one atomically', async () => {
    const { db } = createFakeFirestore();
    const original = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'yearly',
      buyerContact: '@nita',
      notes: 'KHQR paid',
    });

    const reissued = await reissueLicenseHandler(makeCtx(db), {
      keyHash: original.keyHash,
      reason: 'Customer replaced phone and lost key',
    });

    expect(reissued.newKeyHash).not.toBe(original.keyHash);
    expect(reissued.plainKey).not.toBe(original.plainKey);
    expect(reissued.license.status).toBe('active');
    expect(reissued.license.buyerContact).toBe('@nita');
    expect(reissued.license.reissuedFromPrefix).toBe(original.keyHashPrefix);

    const oldAfter = await getLicenseHandler(makeCtx(db), { keyHash: original.keyHash });
    expect(oldAfter.license.status).toBe('revoked');
    expect(oldAfter.license.reissuedToPrefix).toBe(reissued.keyHashPrefix);
  });

  it('exports safe CSV without plain keys and neutralizes spreadsheet formulas', async () => {
    const { db } = createFakeFirestore();
    const created = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'lifetime',
      buyerContact: '=HYPERLINK("http://evil")',
      notes: 'Normal note, with comma',
    });

    const { csv, count } = await exportLicensesCsvHandler(makeCtx(db), {});
    expect(count).toBe(1);
    expect(csv).not.toContain(created.plainKey);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Normal note, with comma"');

    const summary = await getDashboardSummaryHandler(makeCtx(db));
    expect(summary.total).toBe(1);
    expect(summary.byStatus.active).toBe(1);
    expect(summary.byPlan.pro).toBe(1);

    const audit = await listAuditLogsHandler(makeCtx(db), {});
    expect(audit.items.length).toBeGreaterThanOrEqual(2);
  });

  it('scheduled expiry leaves lifetime and future licenses active while expiring overdue ones', async () => {
    const { db } = createFakeFirestore();
    const shortLived = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'monthly',
      expiresAt: new Date(BASE_TIME + 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const lifetime = await createLicenseHandler(makeCtx(db), {
      plan: 'business',
      billing: 'lifetime',
    });
    const longLived = await createLicenseHandler(makeCtx(db), {
      plan: 'pro',
      billing: 'yearly',
    });

    const checkAt = BASE_TIME + 10 * 24 * 60 * 60 * 1000;
    const res = await expireOverdueLicensesHandler({ db, nowMs: checkAt, makeTimestamp });
    expect(res.expiredCount).toBe(1);

    const shortAfter = await getLicenseHandler(makeCtx(db), { keyHash: shortLived.keyHash });
    const lifeAfter = await getLicenseHandler(makeCtx(db), { keyHash: lifetime.keyHash });
    const longAfter = await getLicenseHandler(makeCtx(db), { keyHash: longLived.keyHash });

    expect(shortAfter.license.status).toBe('expired');
    expect(lifeAfter.license.status).toBe('active');
    expect(longAfter.license.status).toBe('active');
  });
});
