import {
  DEFAULT_MAX_DEVICES,
  type AuditLogEntry,
  type BindingMode,
  type CreateLicenseResponse,
  type DashboardSummary,
  type LicenseBilling,
  type LicensePlan,
  type LicenseRecord,
  type LicenseStatus,
  type ReissueLicenseResponse,
} from '../types/license';
import {
  derivePublicKeyFromPrivateHex,
  generateEd25519Keypair,
  generateOfflineLicense,
  verifyOfflineLicense,
} from './offlineLicense';
import { buildTelegramMessages } from './telegramMessagesBrowser';

const LICENSES_STORAGE_KEY = 'kamchi_offline_licenses_v1';
const AUDIT_STORAGE_KEY = 'kamchi_offline_audit_log_v1';
const SIGNING_KEY_STORAGE_KEY = 'kamchi_ed25519_vault_v1';
const DAY_MS = 86_400_000;

const VALID_PLANS: readonly LicensePlan[] = ['pro', 'business'];
const VALID_BILLINGS: readonly LicenseBilling[] = ['monthly', 'yearly', 'lifetime'];
const VALID_STATUSES: readonly LicenseStatus[] = ['active', 'revoked', 'expired'];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getDefaultStorage(): StorageLike {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => {
      mem.set(k, v);
    },
    removeItem: (k) => {
      mem.delete(k);
    },
  };
}

function sanitizeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

interface StoredVaultShape {
  privateKeyHex: string;
  publicKeyHex: string;
}

export class LocalLicenseStore {
  private sessionPrivateKeyHex: string | null = null;
  private sessionPublicKeyHex: string | null = null;

  constructor(private readonly storage: StorageLike = getDefaultStorage()) {}

  // ===========================================================================
  // Signing Key Vault (Never hardcoded; stored only when imported/generated)
  // ===========================================================================
  getSigningKeyStatus(): {
    hasKey: boolean;
    publicKeyHex: string | null;
    persistedInBrowser: boolean;
  } {
    if (this.sessionPrivateKeyHex && this.sessionPublicKeyHex) {
      return {
        hasKey: true,
        publicKeyHex: this.sessionPublicKeyHex,
        persistedInBrowser: Boolean(this.storage.getItem(SIGNING_KEY_STORAGE_KEY)),
      };
    }

    const raw = this.storage.getItem(SIGNING_KEY_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoredVaultShape;
        if (
          typeof parsed.privateKeyHex === 'string' &&
          /^[0-9a-fA-F]{64}$/.test(parsed.privateKeyHex) &&
          typeof parsed.publicKeyHex === 'string'
        ) {
          this.sessionPrivateKeyHex = parsed.privateKeyHex;
          this.sessionPublicKeyHex = parsed.publicKeyHex;
          return {
            hasKey: true,
            publicKeyHex: parsed.publicKeyHex,
            persistedInBrowser: true,
          };
        }
      } catch {
        // ignore corrupt vault
      }
    }

    return { hasKey: false, publicKeyHex: null, persistedInBrowser: false };
  }

  private requirePrivateKeyHex(): string {
    const status = this.getSigningKeyStatus();
    if (!status.hasKey || !this.sessionPrivateKeyHex) {
      throw new Error('No Ed25519 signing key loaded. Configure or generate one in Signing Key Setup.');
    }
    return this.sessionPrivateKeyHex;
  }

  async importSigningKey(
    privateKeyHex: string,
    persistInBrowser = true
  ): Promise<{ publicKeyHex: string }> {
    const { publicKeyHex } = await derivePublicKeyFromPrivateHex(privateKeyHex);
    const cleanPrivate = privateKeyHex.trim().toLowerCase();

    this.sessionPrivateKeyHex = cleanPrivate;
    this.sessionPublicKeyHex = publicKeyHex;

    if (persistInBrowser) {
      this.storage.setItem(
        SIGNING_KEY_STORAGE_KEY,
        JSON.stringify({ privateKeyHex: cleanPrivate, publicKeyHex })
      );
    } else {
      this.storage.removeItem(SIGNING_KEY_STORAGE_KEY);
    }

    this.appendAudit(
      'importSigningKey',
      publicKeyHex.slice(0, 8).toUpperCase(),
      `Loaded Ed25519 signing key (pub=${publicKeyHex.slice(0, 12)}..., persisted=${persistInBrowser})`
    );

    return { publicKeyHex };
  }

  async generateNewSigningKeypair(persistInBrowser = true): Promise<{
    privateKeyHex: string;
    publicKeyHex: string;
  }> {
    const pair = await generateEd25519Keypair();
    this.sessionPrivateKeyHex = pair.privateKeyHex;
    this.sessionPublicKeyHex = pair.publicKeyHex;

    if (persistInBrowser) {
      this.storage.setItem(SIGNING_KEY_STORAGE_KEY, JSON.stringify(pair));
    } else {
      this.storage.removeItem(SIGNING_KEY_STORAGE_KEY);
    }

    this.appendAudit(
      'generateKeypair',
      pair.publicKeyHex.slice(0, 8).toUpperCase(),
      `Generated new Ed25519 keypair (pub=${pair.publicKeyHex.slice(0, 12)}...)`
    );

    return pair;
  }

  clearSigningKey(): void {
    this.sessionPrivateKeyHex = null;
    this.sessionPublicKeyHex = null;
    this.storage.removeItem(SIGNING_KEY_STORAGE_KEY);
    this.appendAudit('clearSigningKey', 'vault', 'Cleared Ed25519 signing key from browser vault');
  }

  // ===========================================================================
  // License & Audit Storage Helpers
  // ===========================================================================
  private readLicenses(): LicenseRecord[] {
    const raw = this.storage.getItem(LICENSES_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as LicenseRecord[]) : [];
    } catch {
      return [];
    }
  }

  private writeLicenses(records: LicenseRecord[]): void {
    this.storage.setItem(LICENSES_STORAGE_KEY, JSON.stringify(records));
  }

  private readAuditLogs(): AuditLogEntry[] {
    const raw = this.storage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AuditLogEntry[]) : [];
    } catch {
      return [];
    }
  }

  private writeAuditLogs(entries: AuditLogEntry[]): void {
    this.storage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(entries.slice(0, 2000)));
  }

  private appendAudit(
    action: string,
    targetKeyIdHex: string,
    details: string,
    nowMs = Date.now()
  ): void {
    const logs = this.readAuditLogs();
    const entry: AuditLogEntry = {
      id: makeId(),
      action,
      actor: 'Local Browser Admin',
      targetKeyIdHex: targetKeyIdHex.slice(0, 16),
      details: details.slice(0, 1000),
      createdAt: new Date(nowMs).toISOString(),
    };
    this.writeAuditLogs([entry, ...logs]);
  }

  private syncOverdueExpirations(nowMs = Date.now()): LicenseRecord[] {
    const records = this.readLicenses();
    let expiredCount = 0;
    const nowIso = new Date(nowMs).toISOString();

    const next = records.map((lic) => {
      if (lic.status === 'active' && lic.expiresAt) {
        const expMs = Date.parse(lic.expiresAt);
        if (!Number.isNaN(expMs) && expMs <= nowMs) {
          expiredCount += 1;
          return { ...lic, status: 'expired' as const, updatedAt: nowIso };
        }
      }
      return lic;
    });

    if (expiredCount > 0) {
      this.writeLicenses(next);
      this.appendAudit(
        'expireOverdueLicenses',
        'batch',
        `Marked ${expiredCount} overdue license(s) as expired`,
        nowMs
      );
    }

    return next;
  }

  // ===========================================================================
  // Console Read Operations
  // ===========================================================================
  async getDashboardSummary(nowMs = Date.now()): Promise<DashboardSummary> {
    const records = this.syncOverdueExpirations(nowMs).sort(
      (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
    );
    const in14DaysMs = nowMs + 14 * DAY_MS;

    const byStatus: Record<LicenseStatus, number> = { active: 0, revoked: 0, expired: 0 };
    const byPlan: Record<LicensePlan, number> = { pro: 0, business: 0 };
    const byBinding: Record<BindingMode, number> = { bound: 0, unbound: 0 };
    const expiringNext14Days: LicenseRecord[] = [];

    for (const lic of records) {
      if (lic.status in byStatus) byStatus[lic.status] += 1;
      if (lic.plan in byPlan) byPlan[lic.plan] += 1;
      if (lic.bindingMode in byBinding) byBinding[lic.bindingMode] += 1;

      if (lic.status === 'active' && lic.expiresAt) {
        const expMs = Date.parse(lic.expiresAt);
        if (!Number.isNaN(expMs) && expMs > nowMs && expMs <= in14DaysMs) {
          expiringNext14Days.push(lic);
        }
      }
    }

    expiringNext14Days.sort((a, b) => Date.parse(a.expiresAt ?? '') - Date.parse(b.expiresAt ?? ''));

    return {
      total: records.length,
      byStatus,
      byPlan,
      byBinding,
      expiringNext14Days: expiringNext14Days.slice(0, 20),
      recentLicenses: records.slice(0, 10),
    };
  }

  async listLicenses(params: {
    query?: string;
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
    bindingMode?: BindingMode | 'all';
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: LicenseRecord[]; nextCursor: string | null }> {
    const records = this.syncOverdueExpirations().sort(
      (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
    );

    const rawQuery = (params.query ?? '').trim().toLowerCase();
    const statusFilter = params.status && params.status !== 'all' ? params.status : null;
    const planFilter = params.plan && params.plan !== 'all' ? params.plan : null;
    const bindingFilter =
      params.bindingMode && params.bindingMode !== 'all' ? params.bindingMode : null;

    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
      throw new Error('Invalid status filter.');
    }
    if (planFilter && !VALID_PLANS.includes(planFilter)) {
      throw new Error('Invalid plan filter.');
    }

    const filtered = records.filter((lic) => {
      if (statusFilter && lic.status !== statusFilter) return false;
      if (planFilter && lic.plan !== planFilter) return false;
      if (bindingFilter && lic.bindingMode !== bindingFilter) return false;
      if (!rawQuery) return true;
      return (
        lic.keyIdHex.toLowerCase().includes(rawQuery) ||
        lic.buyerContact.toLowerCase().includes(rawQuery) ||
        lic.notes.toLowerCase().includes(rawQuery) ||
        (lic.deviceCode ?? '').toLowerCase().includes(rawQuery)
      );
    });

    const pageSize = params.limit && params.limit >= 1 && params.limit <= 100 ? params.limit : 25;
    let startIndex = 0;
    if (params.cursor) {
      const idx = filtered.findIndex((r) => r.keyIdHex === params.cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const slice = filtered.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < filtered.length;

    return {
      items: slice,
      nextCursor: hasMore && slice.length > 0 ? slice[slice.length - 1].keyIdHex : null,
    };
  }

  async getLicense(keyIdHex: string): Promise<{ license: LicenseRecord }> {
    const records = this.syncOverdueExpirations();
    const found = records.find((r) => r.keyIdHex === keyIdHex);
    if (!found) {
      throw new Error('License record not found in local storage.');
    }
    return { license: found };
  }

  // ===========================================================================
  // Issue / Renew / Reissue Offline KC1 License Keys
  // ===========================================================================
  async createLicense(
    input: {
      plan: LicensePlan;
      billing: LicenseBilling;
      durationDays?: number;
      customExpiresAtMs?: number | null;
      maxDevices?: number;
      bindingMode: BindingMode;
      deviceCode?: string;
      buyerContact?: string;
      notes?: string;
    },
    nowMs = Date.now()
  ): Promise<CreateLicenseResponse> {
    if (!VALID_PLANS.includes(input.plan)) throw new Error('Plan must be Pro or Business.');
    if (!VALID_BILLINGS.includes(input.billing)) throw new Error('Invalid billing cycle.');

    const privateKeyHex = this.requirePrivateKeyHex();
    const maxDevices = input.maxDevices ?? DEFAULT_MAX_DEVICES[input.plan];

    const generated = await generateOfflineLicense({
      privateKeyHex,
      plan: input.plan,
      billing: input.billing,
      issuedAtMs: nowMs,
      durationDays: input.durationDays,
      customExpiresAtMs: input.customExpiresAtMs,
      maxDevices,
      bindingMode: input.bindingMode,
      deviceCode: input.deviceCode,
    });

    const selfVerify = await verifyOfflineLicense({
      kc1Key: generated.plainKey,
      publicKeyHex: generated.publicKeyHex,
      expectedDeviceCode: generated.normalizedDeviceCode,
    });

    if (!selfVerify.valid) {
      throw new Error(`Self-verification failed: ${selfVerify.error ?? 'signature mismatch'}`);
    }

    const nowIso = new Date(nowMs).toISOString();
    const buyerContact = (input.buyerContact ?? '').trim().slice(0, 200);
    const notes = (input.notes ?? '').trim().slice(0, 1000);

    const license: LicenseRecord = {
      id: generated.keyIdHex,
      keyIdHex: generated.keyIdHex,
      maskedKey: generated.maskedKey,
      plan: input.plan,
      billing: input.billing,
      status: 'active',
      issuedAt: new Date(nowMs).toISOString(),
      expiresAt: generated.expiresAtIso,
      issuedAtDay: generated.issuedAtDay,
      expiresAtDay: generated.expiresAtDay,
      maxDevices: generated.maxDevices,
      bindingMode: generated.bindingMode,
      deviceCode: generated.normalizedDeviceCode,
      deviceCodeHashHex: generated.deviceCodeHashHex,
      publicKeyHex: generated.publicKeyHex,
      buyerContact,
      notes,
      revokedReason: null,
      revokedAt: null,
      reissuedToKeyId: null,
      reissuedFromKeyId: null,
      updatedAt: nowIso,
    };

    const records = this.readLicenses();
    this.writeLicenses([license, ...records]);
    this.appendAudit(
      'createLicense',
      generated.keyIdHex,
      `Issued KC1 ${input.plan}/${input.billing} (${generated.bindingMode}${
        generated.normalizedDeviceCode ? ` ${generated.normalizedDeviceCode}` : ''
      })${buyerContact ? `, buyer=${buyerContact}` : ''}`,
      nowMs
    );

    return {
      keyIdHex: generated.keyIdHex,
      plainKey: generated.plainKey,
      kamchiLicenseFileName: generated.kamchiLicenseFileName,
      kamchiLicenseFileContent: generated.kamchiLicenseFileContent,
      selfVerify,
      license,
      telegramMessages: buildTelegramMessages({
        plan: input.plan,
        billing: input.billing,
        plainKey: generated.plainKey,
        keyIdHex: generated.keyIdHex,
        expiresAtIso: generated.expiresAtIso,
        maxDevices: generated.maxDevices,
        bindingMode: generated.bindingMode,
        deviceCode: generated.normalizedDeviceCode,
      }),
    };
  }

  async renewLicense(
    input: {
      keyIdHex: string;
      billing: LicenseBilling;
      durationDays?: number;
      customExpiresAtMs?: number | null;
    },
    nowMs = Date.now()
  ): Promise<ReissueLicenseResponse> {
    const records = this.syncOverdueExpirations(nowMs);
    const idx = records.findIndex((r) => r.keyIdHex === input.keyIdHex);
    if (idx < 0) throw new Error('Original license record not found.');

    const oldDoc = records[idx];
    const privateKeyHex = this.requirePrivateKeyHex();

    const generated = await generateOfflineLicense({
      privateKeyHex,
      plan: oldDoc.plan,
      billing: input.billing,
      issuedAtMs: nowMs,
      durationDays: input.durationDays,
      customExpiresAtMs: input.customExpiresAtMs,
      maxDevices: oldDoc.maxDevices,
      bindingMode: oldDoc.bindingMode,
      deviceCode: oldDoc.deviceCode ?? undefined,
    });

    const selfVerify = await verifyOfflineLicense({
      kc1Key: generated.plainKey,
      publicKeyHex: generated.publicKeyHex,
      expectedDeviceCode: generated.normalizedDeviceCode,
    });

    if (!selfVerify.valid) {
      throw new Error(`Self-verification failed: ${selfVerify.error ?? 'signature mismatch'}`);
    }

    const nowIso = new Date(nowMs).toISOString();
    const newLicense: LicenseRecord = {
      id: generated.keyIdHex,
      keyIdHex: generated.keyIdHex,
      maskedKey: generated.maskedKey,
      plan: oldDoc.plan,
      billing: input.billing,
      status: 'active',
      issuedAt: nowIso,
      expiresAt: generated.expiresAtIso,
      issuedAtDay: generated.issuedAtDay,
      expiresAtDay: generated.expiresAtDay,
      maxDevices: generated.maxDevices,
      bindingMode: generated.bindingMode,
      deviceCode: generated.normalizedDeviceCode,
      deviceCodeHashHex: generated.deviceCodeHashHex,
      publicKeyHex: generated.publicKeyHex,
      buyerContact: oldDoc.buyerContact,
      notes: oldDoc.notes,
      revokedReason: null,
      revokedAt: null,
      reissuedToKeyId: null,
      reissuedFromKeyId: oldDoc.keyIdHex,
      updatedAt: nowIso,
    };

    records[idx] = {
      ...oldDoc,
      status: 'revoked',
      revokedReason: `Renewed to ${generated.keyIdHex}`,
      revokedAt: nowIso,
      reissuedToKeyId: generated.keyIdHex,
      updatedAt: nowIso,
    };

    this.writeLicenses([newLicense, ...records]);
    this.appendAudit(
      'renewLicense',
      generated.keyIdHex,
      `Renewed from ${oldDoc.keyIdHex} (${oldDoc.plan}/${input.billing})`,
      nowMs
    );

    return {
      keyIdHex: generated.keyIdHex,
      oldKeyIdHex: oldDoc.keyIdHex,
      newKeyIdHex: generated.keyIdHex,
      plainKey: generated.plainKey,
      kamchiLicenseFileName: generated.kamchiLicenseFileName,
      kamchiLicenseFileContent: generated.kamchiLicenseFileContent,
      selfVerify,
      license: newLicense,
      telegramMessages: buildTelegramMessages({
        plan: oldDoc.plan,
        billing: input.billing,
        plainKey: generated.plainKey,
        keyIdHex: generated.keyIdHex,
        expiresAtIso: generated.expiresAtIso,
        maxDevices: oldDoc.maxDevices,
        bindingMode: generated.bindingMode,
        deviceCode: generated.normalizedDeviceCode,
      }),
    };
  }

  async reissueLicense(
    input: {
      keyIdHex: string;
      plan?: LicensePlan;
      maxDevices?: number;
      bindingMode: BindingMode;
      deviceCode?: string;
      reason?: string;
    },
    nowMs = Date.now()
  ): Promise<ReissueLicenseResponse> {
    const records = this.syncOverdueExpirations(nowMs);
    const idx = records.findIndex((r) => r.keyIdHex === input.keyIdHex);
    if (idx < 0) throw new Error('License record not found.');

    const oldDoc = records[idx];
    const privateKeyHex = this.requirePrivateKeyHex();
    const nextPlan = input.plan ?? oldDoc.plan;
    const nextMaxDevices = input.maxDevices ?? oldDoc.maxDevices;

    let customExpiresAtMs: number | null = null;
    if (oldDoc.billing !== 'lifetime' && oldDoc.expiresAt) {
      const oldExpMs = Date.parse(oldDoc.expiresAt);
      if (oldExpMs <= nowMs) {
        throw new Error('Cannot reissue an expired license; use Renew instead.');
      }
      customExpiresAtMs = oldExpMs;
    }

    const generated = await generateOfflineLicense({
      privateKeyHex,
      plan: nextPlan,
      billing: oldDoc.billing,
      issuedAtMs: nowMs,
      customExpiresAtMs,
      maxDevices: nextMaxDevices,
      bindingMode: input.bindingMode,
      deviceCode: input.deviceCode,
    });

    const selfVerify = await verifyOfflineLicense({
      kc1Key: generated.plainKey,
      publicKeyHex: generated.publicKeyHex,
      expectedDeviceCode: generated.normalizedDeviceCode,
    });

    if (!selfVerify.valid) {
      throw new Error(`Self-verification failed: ${selfVerify.error ?? 'signature mismatch'}`);
    }

    const nowIso = new Date(nowMs).toISOString();
    const reason = (input.reason ?? '').trim() || `Reissued to ${generated.keyIdHex}`;

    const newLicense: LicenseRecord = {
      id: generated.keyIdHex,
      keyIdHex: generated.keyIdHex,
      maskedKey: generated.maskedKey,
      plan: nextPlan,
      billing: oldDoc.billing,
      status: 'active',
      issuedAt: nowIso,
      expiresAt: generated.expiresAtIso,
      issuedAtDay: generated.issuedAtDay,
      expiresAtDay: generated.expiresAtDay,
      maxDevices: nextMaxDevices,
      bindingMode: generated.bindingMode,
      deviceCode: generated.normalizedDeviceCode,
      deviceCodeHashHex: generated.deviceCodeHashHex,
      publicKeyHex: generated.publicKeyHex,
      buyerContact: oldDoc.buyerContact,
      notes: oldDoc.notes,
      revokedReason: null,
      revokedAt: null,
      reissuedToKeyId: null,
      reissuedFromKeyId: oldDoc.keyIdHex,
      updatedAt: nowIso,
    };

    records[idx] = {
      ...oldDoc,
      status: 'revoked',
      revokedReason: reason,
      revokedAt: nowIso,
      reissuedToKeyId: generated.keyIdHex,
      updatedAt: nowIso,
    };

    this.writeLicenses([newLicense, ...records]);
    this.appendAudit(
      'reissueLicense',
      generated.keyIdHex,
      `Reissued from ${oldDoc.keyIdHex} (${nextPlan}, ${generated.bindingMode}${
        generated.normalizedDeviceCode ? ` ${generated.normalizedDeviceCode}` : ''
      })`,
      nowMs
    );

    return {
      keyIdHex: generated.keyIdHex,
      oldKeyIdHex: oldDoc.keyIdHex,
      newKeyIdHex: generated.keyIdHex,
      plainKey: generated.plainKey,
      kamchiLicenseFileName: generated.kamchiLicenseFileName,
      kamchiLicenseFileContent: generated.kamchiLicenseFileContent,
      selfVerify,
      license: newLicense,
      telegramMessages: buildTelegramMessages({
        plan: nextPlan,
        billing: oldDoc.billing,
        plainKey: generated.plainKey,
        keyIdHex: generated.keyIdHex,
        expiresAtIso: generated.expiresAtIso,
        maxDevices: nextMaxDevices,
        bindingMode: generated.bindingMode,
        deviceCode: generated.normalizedDeviceCode,
      }),
    };
  }

  async revokeLicense(
    input: { keyIdHex: string; reason: string },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    const reason = input.reason.trim().slice(0, 500);
    if (!reason) throw new Error('A revocation reason is required.');

    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyIdHex === input.keyIdHex);
    if (idx < 0) throw new Error('License record not found.');

    const nowIso = new Date(nowMs).toISOString();
    const updated: LicenseRecord = {
      ...records[idx],
      status: 'revoked',
      revokedReason: reason,
      revokedAt: nowIso,
      updatedAt: nowIso,
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit('revokeLicense', updated.keyIdHex, `Marked revoked in log: ${reason}`, nowMs);

    return { license: updated };
  }

  async reinstateLicense(keyIdHex: string, nowMs = Date.now()): Promise<{ license: LicenseRecord }> {
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyIdHex === keyIdHex);
    if (idx < 0) throw new Error('License record not found.');

    const existing = records[idx];
    if (existing.expiresAt && Date.parse(existing.expiresAt) <= nowMs) {
      throw new Error('License expiration date has passed. Use Renew to generate a new key.');
    }

    const updated: LicenseRecord = {
      ...existing,
      status: 'active',
      revokedReason: null,
      revokedAt: null,
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit('reinstateLicense', updated.keyIdHex, 'Marked active in log', nowMs);

    return { license: updated };
  }

  async updateBuyerMeta(
    input: { keyIdHex: string; buyerContact: string; notes: string },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyIdHex === input.keyIdHex);
    if (idx < 0) throw new Error('License record not found.');

    const updated: LicenseRecord = {
      ...records[idx],
      buyerContact: input.buyerContact.trim().slice(0, 200),
      notes: input.notes.trim().slice(0, 1000),
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit('updateBuyerMeta', updated.keyIdHex, 'Updated buyer contact / notes', nowMs);

    return { license: updated };
  }

  async exportLicensesCsv(params: {
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
  }): Promise<{ csv: string; count: number }> {
    const records = this.syncOverdueExpirations().sort(
      (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
    );
    const statusFilter = params.status && params.status !== 'all' ? params.status : null;
    const planFilter = params.plan && params.plan !== 'all' ? params.plan : null;

    const filtered = records.filter((lic) => {
      if (statusFilter && lic.status !== statusFilter) return false;
      if (planFilter && lic.plan !== planFilter) return false;
      return true;
    });

    const header = [
      'keyIdHex',
      'maskedKey',
      'plan',
      'billing',
      'status',
      'bindingMode',
      'deviceCode',
      'issuedAt',
      'expiresAt',
      'maxDevices',
      'buyerContact',
      'notes',
      'revokedReason',
    ].join(',');

    const rows = filtered.map((s) =>
      [
        sanitizeCsvCell(s.keyIdHex),
        sanitizeCsvCell(s.maskedKey),
        sanitizeCsvCell(s.plan),
        sanitizeCsvCell(s.billing),
        sanitizeCsvCell(s.status),
        sanitizeCsvCell(s.bindingMode),
        sanitizeCsvCell(s.deviceCode ?? 'unbound'),
        sanitizeCsvCell(s.issuedAt),
        sanitizeCsvCell(s.expiresAt ?? 'lifetime'),
        sanitizeCsvCell(s.maxDevices),
        sanitizeCsvCell(s.buyerContact),
        sanitizeCsvCell(s.notes),
        sanitizeCsvCell(s.revokedReason ?? ''),
      ].join(',')
    );

    this.appendAudit(
      'exportLicensesCsv',
      'batch',
      `Exported ${rows.length} license row(s) (status=${statusFilter ?? 'all'}, plan=${planFilter ?? 'all'})`
    );

    return {
      csv: [header, ...rows].join('\n'),
      count: rows.length,
    };
  }

  async listAuditLogs(params: {
    action?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: AuditLogEntry[]; nextCursor: string | null }> {
    const logs = this.readAuditLogs();
    const actionFilter = params.action && params.action !== 'all' ? params.action : null;
    const filtered = actionFilter ? logs.filter((l) => l.action === actionFilter) : logs;

    const pageSize = params.limit && params.limit >= 1 && params.limit <= 100 ? params.limit : 30;
    let startIndex = 0;
    if (params.cursor) {
      const idx = filtered.findIndex((l) => l.id === params.cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const slice = filtered.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < filtered.length;

    return {
      items: slice,
      nextCursor: hasMore && slice.length > 0 ? slice[slice.length - 1].id : null,
    };
  }

  exportBackupJson(): string {
    // Intentionally excludes private signing key so backups can be stored safely
    return JSON.stringify(
      {
        version: 2,
        exportedAt: new Date().toISOString(),
        licenses: this.readLicenses(),
        auditLog: this.readAuditLogs(),
      },
      null,
      2
    );
  }

  importBackupJson(rawJson: string): { licenseCount: number; auditCount: number } {
    const parsed = JSON.parse(rawJson) as {
      licenses?: LicenseRecord[];
      auditLog?: AuditLogEntry[];
    };
    if (!parsed || !Array.isArray(parsed.licenses)) {
      throw new Error('Invalid backup file: missing licenses array.');
    }
    this.writeLicenses(parsed.licenses);
    const logs = Array.isArray(parsed.auditLog) ? parsed.auditLog : [];
    this.writeAuditLogs(logs);
    this.appendAudit('importBackup', 'batch', `Imported ${parsed.licenses.length} license(s) from JSON backup`);
    return { licenseCount: parsed.licenses.length, auditCount: logs.length };
  }

  clearAllLicenseRecords(): void {
    this.storage.removeItem(LICENSES_STORAGE_KEY);
    this.storage.removeItem(AUDIT_STORAGE_KEY);
  }
}

export const localLicenseStore = new LocalLicenseStore();
