import {
  DEFAULT_MAX_DEVICES,
  type AuditLogEntry,
  type CreateLicenseResponse,
  type DashboardSummary,
  type LicenseBilling,
  type LicensePlan,
  type LicenseRecord,
  type LicenseStatus,
  type ReissueLicenseResponse,
} from '../types/license';
import {
  generateLicenseKey,
  generateRandomPepper,
  getKeyHashPrefix,
  hashLicenseKeyBrowser,
} from './licenseKeyBrowser';
import { buildTelegramMessages } from './telegramMessagesBrowser';

const LICENSES_STORAGE_KEY = 'kamchi_licenses_v1';
const AUDIT_STORAGE_KEY = 'kamchi_audit_log_v1';
const PEPPER_STORAGE_KEY = 'kamchi_local_pepper_v1';
const DAY_MS = 24 * 60 * 60 * 1000;

const VALID_PLANS: readonly LicensePlan[] = ['free', 'pro', 'business'];
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
  return `log_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export class LocalLicenseStore {
  constructor(private readonly storage: StorageLike = getDefaultStorage()) {}

  getPepper(): string {
    const existing = this.storage.getItem(PEPPER_STORAGE_KEY);
    if (existing && existing.length >= 16) {
      return existing;
    }
    const created = generateRandomPepper();
    this.storage.setItem(PEPPER_STORAGE_KEY, created);
    return created;
  }

  setPepper(nextPepper: string): void {
    const trimmed = nextPepper.trim();
    if (trimmed.length < 16) {
      throw new Error('Pepper must be at least 16 characters.');
    }
    this.storage.setItem(PEPPER_STORAGE_KEY, trimmed);
    this.appendAudit('updatePepper', 'config', 'Updated local HMAC-SHA256 pepper');
  }

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

  private appendAudit(action: string, targetKeyHashPrefix: string, details: string, nowMs = Date.now()): void {
    const logs = this.readAuditLogs();
    const entry: AuditLogEntry = {
      id: makeId(),
      action,
      actorUid: 'local-browser',
      actorEmail: 'Local Browser Admin',
      targetKeyHashPrefix: targetKeyHashPrefix.slice(0, 16),
      details: details.slice(0, 1000),
      createdAt: new Date(nowMs).toISOString(),
    };
    this.writeAuditLogs([entry, ...logs]);
  }

  /**
   * Automatically marks active licenses past their expiresAt as expired,
   * matching the server-side scheduled expiry behavior.
   */
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

  async getDashboardSummary(nowMs = Date.now()): Promise<DashboardSummary> {
    const records = this.syncOverdueExpirations(nowMs).sort(
      (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
    );
    const in14DaysMs = nowMs + 14 * DAY_MS;

    const byStatus: Record<LicenseStatus, number> = { active: 0, revoked: 0, expired: 0 };
    const byPlan: Record<LicensePlan, number> = { free: 0, pro: 0, business: 0 };
    const expiringNext14Days: LicenseRecord[] = [];
    const activations: Array<DashboardSummary['recentActivations'][number] & { activatedAtMs: number }> = [];

    for (const lic of records) {
      if (lic.status in byStatus) byStatus[lic.status] += 1;
      if (lic.plan in byPlan) byPlan[lic.plan] += 1;

      if (lic.status === 'active' && lic.expiresAt) {
        const expMs = Date.parse(lic.expiresAt);
        if (!Number.isNaN(expMs) && expMs > nowMs && expMs <= in14DaysMs) {
          expiringNext14Days.push(lic);
        }
      }

      for (const dev of lic.devices) {
        activations.push({
          keyHash: lic.keyHash,
          keyHashPrefix: lic.keyHashPrefix,
          plan: lic.plan,
          buyerContact: lic.buyerContact,
          deviceId: dev.deviceId,
          label: dev.label,
          activatedAt: dev.activatedAt,
          activatedAtMs: Date.parse(dev.activatedAt) || 0,
        });
      }
    }

    expiringNext14Days.sort((a, b) => Date.parse(a.expiresAt ?? '') - Date.parse(b.expiresAt ?? ''));
    activations.sort((a, b) => b.activatedAtMs - a.activatedAtMs);

    return {
      total: records.length,
      byStatus,
      byPlan,
      expiringNext14Days: expiringNext14Days.slice(0, 20),
      recentActivations: activations.slice(0, 15).map(({ activatedAtMs: _ignore, ...rest }) => rest),
    };
  }

  async listLicenses(params: {
    query?: string;
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
    cursor?: string | null;
    limit?: number;
  }): Promise<{ items: LicenseRecord[]; nextCursor: string | null }> {
    const records = this.syncOverdueExpirations().sort(
      (a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt)
    );

    const rawQuery = (params.query ?? '').trim().toLowerCase();
    const statusFilter = params.status && params.status !== 'all' ? params.status : null;
    const planFilter = params.plan && params.plan !== 'all' ? params.plan : null;

    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
      throw new Error('Invalid status filter.');
    }
    if (planFilter && !VALID_PLANS.includes(planFilter)) {
      throw new Error('Invalid plan filter.');
    }

    const filtered = records.filter((lic) => {
      if (statusFilter && lic.status !== statusFilter) return false;
      if (planFilter && lic.plan !== planFilter) return false;
      if (!rawQuery) return true;
      return (
        lic.keyHash.toLowerCase().startsWith(rawQuery) ||
        lic.buyerContact.toLowerCase().includes(rawQuery) ||
        lic.notes.toLowerCase().includes(rawQuery)
      );
    });

    const pageSize = params.limit && params.limit >= 1 && params.limit <= 100 ? params.limit : 25;
    let startIndex = 0;
    if (params.cursor) {
      const idx = filtered.findIndex((r) => r.keyHash === params.cursor);
      if (idx >= 0) startIndex = idx + 1;
    }

    const slice = filtered.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageSize < filtered.length;

    return {
      items: slice,
      nextCursor: hasMore && slice.length > 0 ? slice[slice.length - 1].keyHash : null,
    };
  }

  async getLicense(keyHash: string): Promise<{ license: LicenseRecord }> {
    const records = this.syncOverdueExpirations();
    const found = records.find((r) => r.keyHash === keyHash);
    if (!found) {
      throw new Error('License not found in local browser storage.');
    }
    return { license: found };
  }

  async createLicense(
    input: {
      plan: LicensePlan;
      billing: LicenseBilling;
      expiresAt?: string | null;
      maxDevices?: number;
      buyerContact?: string;
      notes?: string;
    },
    nowMs = Date.now()
  ): Promise<CreateLicenseResponse> {
    if (!VALID_PLANS.includes(input.plan)) throw new Error('Invalid plan.');
    if (!VALID_BILLINGS.includes(input.billing)) throw new Error('Invalid billing cycle.');

    const maxDevices =
      typeof input.maxDevices === 'number' && Number.isInteger(input.maxDevices) && input.maxDevices >= 1
        ? Math.min(input.maxDevices, 100)
        : DEFAULT_MAX_DEVICES[input.plan];

    let expiresAtIso: string | null = null;
    if (input.expiresAt === undefined) {
      if (input.billing === 'monthly') expiresAtIso = new Date(nowMs + 30 * DAY_MS).toISOString();
      else if (input.billing === 'yearly') expiresAtIso = new Date(nowMs + 365 * DAY_MS).toISOString();
    } else if (input.expiresAt !== null && input.expiresAt !== '') {
      const parsed = Date.parse(input.expiresAt);
      if (Number.isNaN(parsed) || parsed <= nowMs) {
        throw new Error('Expiration date must be in the future.');
      }
      expiresAtIso = new Date(parsed).toISOString();
    }

    const pepper = this.getPepper();
    const records = this.readLicenses();

    let plainKey = '';
    let keyHash = '';
    for (let i = 0; i < 5; i++) {
      plainKey = generateLicenseKey(input.plan);
      keyHash = await hashLicenseKeyBrowser(plainKey, pepper);
      if (!records.some((r) => r.keyHash === keyHash)) break;
    }

    const nowIso = new Date(nowMs).toISOString();
    const keyHashPrefix = getKeyHashPrefix(keyHash);
    const buyerContact = (input.buyerContact ?? '').trim().slice(0, 200);
    const notes = (input.notes ?? '').trim().slice(0, 1000);

    const license: LicenseRecord = {
      keyHash,
      keyHashPrefix,
      plan: input.plan,
      billing: input.billing,
      status: 'active',
      issuedAt: nowIso,
      expiresAt: expiresAtIso,
      maxDevices,
      buyerContact,
      notes,
      devices: [],
      revokedReason: null,
      revokedAt: null,
      reissuedToPrefix: null,
      reissuedFromPrefix: null,
      updatedAt: nowIso,
    };

    this.writeLicenses([license, ...records]);
    this.appendAudit(
      'createLicense',
      keyHashPrefix,
      `Issued ${input.plan} (${input.billing}), maxDevices=${maxDevices}${buyerContact ? `, buyer=${buyerContact}` : ''}`,
      nowMs
    );

    return {
      keyHash,
      keyHashPrefix,
      plainKey,
      license,
      telegramMessages: buildTelegramMessages({
        plan: input.plan,
        billing: input.billing,
        plainKey,
        expiresAtIso,
        maxDevices,
      }),
    };
  }

  async extendLicense(
    input: { keyHash: string; newExpiresAt?: string | null; addDays?: number },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    const records = this.syncOverdueExpirations(nowMs);
    const idx = records.findIndex((r) => r.keyHash === input.keyHash);
    if (idx < 0) throw new Error('License not found.');

    const existing = records[idx];
    if (existing.status === 'revoked') {
      throw new Error('Cannot extend a revoked license. Reinstate it first.');
    }

    let nextExpiresIso: string | null = null;
    let nextBilling = existing.billing;

    if (input.addDays !== undefined) {
      if (!Number.isInteger(input.addDays) || input.addDays < 1 || input.addDays > 3650) {
        throw new Error('addDays must be between 1 and 3650.');
      }
      if (!existing.expiresAt) {
        throw new Error('Lifetime licenses already have no expiration date.');
      }
      const baseMs = Math.max(Date.parse(existing.expiresAt), nowMs);
      nextExpiresIso = new Date(baseMs + input.addDays * DAY_MS).toISOString();
    } else if (input.newExpiresAt === null) {
      nextExpiresIso = null;
      nextBilling = 'lifetime';
    } else if (input.newExpiresAt) {
      const parsed = Date.parse(input.newExpiresAt);
      if (Number.isNaN(parsed) || parsed <= nowMs) {
        throw new Error('New expiration date must be in the future.');
      }
      nextExpiresIso = new Date(parsed).toISOString();
    } else {
      throw new Error('Provide either addDays or newExpiresAt.');
    }

    const updated: LicenseRecord = {
      ...existing,
      expiresAt: nextExpiresIso,
      billing: nextBilling,
      status: 'active',
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit(
      'extendLicense',
      existing.keyHashPrefix,
      input.addDays
        ? `Extended by +${input.addDays} days (new expiresAt=${nextExpiresIso ?? 'lifetime'})`
        : `Set expiresAt=${nextExpiresIso ?? 'lifetime'}`,
      nowMs
    );

    return { license: updated };
  }

  async changePlan(
    input: { keyHash: string; plan: LicensePlan; maxDevices?: number },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    if (!VALID_PLANS.includes(input.plan)) throw new Error('Invalid plan.');
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyHash === input.keyHash);
    if (idx < 0) throw new Error('License not found.');

    const existing = records[idx];
    const maxDevices =
      typeof input.maxDevices === 'number' && Number.isInteger(input.maxDevices) && input.maxDevices >= 1
        ? Math.min(input.maxDevices, 100)
        : DEFAULT_MAX_DEVICES[input.plan];

    const updated: LicenseRecord = {
      ...existing,
      plan: input.plan,
      maxDevices,
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit(
      'changePlan',
      existing.keyHashPrefix,
      `Changed plan ${existing.plan} -> ${input.plan}, maxDevices=${maxDevices}`,
      nowMs
    );

    return { license: updated };
  }

  async revokeLicense(
    input: { keyHash: string; reason: string },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    const reason = input.reason.trim().slice(0, 500);
    if (!reason) throw new Error('A revocation reason is required.');

    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyHash === input.keyHash);
    if (idx < 0) throw new Error('License not found.');

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
    this.appendAudit('revokeLicense', updated.keyHashPrefix, `Revoked license: ${reason}`, nowMs);

    return { license: updated };
  }

  async reinstateLicense(keyHash: string, nowMs = Date.now()): Promise<{ license: LicenseRecord }> {
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyHash === keyHash);
    if (idx < 0) throw new Error('License not found.');

    const existing = records[idx];
    if (existing.expiresAt && Date.parse(existing.expiresAt) <= nowMs) {
      throw new Error('License expiration date has already passed. Extend the expiry date instead.');
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
    this.appendAudit('reinstateLicense', updated.keyHashPrefix, 'Reinstated license to active status', nowMs);

    return { license: updated };
  }

  async resetDevices(keyHash: string, nowMs = Date.now()): Promise<{ license: LicenseRecord }> {
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyHash === keyHash);
    if (idx < 0) throw new Error('License not found.');

    const prevCount = records[idx].devices.length;
    const updated: LicenseRecord = {
      ...records[idx],
      devices: [],
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit('resetDevices', updated.keyHashPrefix, `Cleared ${prevCount} bound device(s)`, nowMs);

    return { license: updated };
  }

  async removeDevice(
    input: { keyHash: string; deviceId: string },
    nowMs = Date.now()
  ): Promise<{ license: LicenseRecord }> {
    const records = this.readLicenses();
    const idx = records.findIndex((r) => r.keyHash === input.keyHash);
    if (idx < 0) throw new Error('License not found.');

    const existing = records[idx];
    const nextDevices = existing.devices.filter((d) => d.deviceId !== input.deviceId);
    if (nextDevices.length === existing.devices.length) {
      throw new Error('Device not found on this license.');
    }

    const updated: LicenseRecord = {
      ...existing,
      devices: nextDevices,
      updatedAt: new Date(nowMs).toISOString(),
    };

    records[idx] = updated;
    this.writeLicenses(records);
    this.appendAudit('removeDevice', updated.keyHashPrefix, `Removed device ${input.deviceId}`, nowMs);

    return { license: updated };
  }

  async reissueLicense(
    input: { keyHash: string; reason?: string },
    nowMs = Date.now()
  ): Promise<ReissueLicenseResponse> {
    const records = this.syncOverdueExpirations(nowMs);
    const idx = records.findIndex((r) => r.keyHash === input.keyHash);
    if (idx < 0) throw new Error('License not found.');

    const oldDoc = records[idx];
    if (oldDoc.expiresAt && Date.parse(oldDoc.expiresAt) <= nowMs) {
      throw new Error('Cannot reissue an expired license without extending it first.');
    }

    const pepper = this.getPepper();
    let plainKey = '';
    let newKeyHash = '';
    for (let i = 0; i < 5; i++) {
      plainKey = generateLicenseKey(oldDoc.plan);
      newKeyHash = await hashLicenseKeyBrowser(plainKey, pepper);
      if (!records.some((r) => r.keyHash === newKeyHash)) break;
    }

    const newPrefix = getKeyHashPrefix(newKeyHash);
    const nowIso = new Date(nowMs).toISOString();
    const revokeReason = (input.reason ?? '').trim() || `Reissued to ${newPrefix}`;

    const newDoc: LicenseRecord = {
      keyHash: newKeyHash,
      keyHashPrefix: newPrefix,
      plan: oldDoc.plan,
      billing: oldDoc.billing,
      status: 'active',
      issuedAt: nowIso,
      expiresAt: oldDoc.expiresAt,
      maxDevices: oldDoc.maxDevices,
      buyerContact: oldDoc.buyerContact,
      notes: oldDoc.notes,
      devices: [],
      revokedReason: null,
      revokedAt: null,
      reissuedToPrefix: null,
      reissuedFromPrefix: oldDoc.keyHashPrefix,
      updatedAt: nowIso,
    };

    records[idx] = {
      ...oldDoc,
      status: 'revoked',
      revokedReason: revokeReason,
      revokedAt: nowIso,
      reissuedToPrefix: newPrefix,
      updatedAt: nowIso,
    };

    this.writeLicenses([newDoc, ...records]);
    this.appendAudit(
      'reissueLicense',
      newPrefix,
      `Reissued from ${oldDoc.keyHashPrefix} (${oldDoc.plan}/${oldDoc.billing}); old key revoked`,
      nowMs
    );

    return {
      keyHash: newKeyHash,
      oldKeyHash: oldDoc.keyHash,
      newKeyHash,
      keyHashPrefix: newPrefix,
      plainKey,
      license: newDoc,
      telegramMessages: buildTelegramMessages({
        plan: oldDoc.plan,
        billing: oldDoc.billing,
        plainKey,
        expiresAtIso: newDoc.expiresAt,
        maxDevices: oldDoc.maxDevices,
      }),
    };
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
      'keyHashPrefix',
      'plan',
      'billing',
      'status',
      'issuedAt',
      'expiresAt',
      'maxDevices',
      'deviceCount',
      'buyerContact',
      'notes',
      'revokedReason',
    ].join(',');

    const rows = filtered.map((s) =>
      [
        sanitizeCsvCell(s.keyHashPrefix),
        sanitizeCsvCell(s.plan),
        sanitizeCsvCell(s.billing),
        sanitizeCsvCell(s.status),
        sanitizeCsvCell(s.issuedAt),
        sanitizeCsvCell(s.expiresAt ?? 'lifetime'),
        sanitizeCsvCell(s.maxDevices),
        sanitizeCsvCell(s.devices.length),
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
    return JSON.stringify(
      {
        version: 1,
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

  clearAllLocalData(): void {
    this.storage.removeItem(LICENSES_STORAGE_KEY);
    this.storage.removeItem(AUDIT_STORAGE_KEY);
  }
}

export const localLicenseStore = new LocalLicenseStore();
