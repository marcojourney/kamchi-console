import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import {
  DEFAULT_MAX_DEVICES,
  generateLicenseKey,
  getKeyHashPrefix,
  hashLicenseKey,
  type LicenseBilling,
  type LicensePlan,
  type LicenseStatus,
} from './licenseKey.js';
import { assertAdmin, checkRateLimit, writeAuditLog, type AdminActor } from './security.js';
import { buildTelegramMessages } from './telegramMessages.js';

export interface DeviceRecord {
  deviceId: string;
  label: string;
  activatedAt: string;
  lastSeenAt: string;
}

export interface StoredDeviceRecord {
  deviceId: string;
  label: string;
  activatedAt: Timestamp;
  lastSeenAt: Timestamp;
}

export interface StoredLicenseDoc {
  plan: LicensePlan;
  billing: LicenseBilling;
  status: LicenseStatus;
  issuedAt: Timestamp;
  expiresAt: Timestamp | null;
  maxDevices: number;
  buyerContact: string;
  notes: string;
  devices: StoredDeviceRecord[];
  revokedReason?: string | null;
  revokedAt?: Timestamp | null;
  reissuedToPrefix?: string | null;
  reissuedFromPrefix?: string | null;
  updatedAt?: Timestamp;
}

export interface SerializedLicense {
  keyHash: string;
  keyHashPrefix: string;
  plan: LicensePlan;
  billing: LicenseBilling;
  status: LicenseStatus;
  issuedAt: string;
  expiresAt: string | null;
  maxDevices: number;
  buyerContact: string;
  notes: string;
  devices: DeviceRecord[];
  revokedReason: string | null;
  revokedAt: string | null;
  reissuedToPrefix: string | null;
  reissuedFromPrefix: string | null;
  updatedAt: string | null;
}

export interface HandlerContext {
  db: Firestore;
  pepper: string;
  auth: { uid: string; token: Record<string, unknown> } | undefined | null;
  nowMs?: number;
  makeTimestamp: (ms: number) => Timestamp;
  skipRateLimit?: boolean;
}

const VALID_PLANS: readonly LicensePlan[] = ['free', 'pro', 'business'];
const VALID_BILLINGS: readonly LicenseBilling[] = ['monthly', 'yearly', 'lifetime'];
const VALID_STATUSES: readonly LicenseStatus[] = ['active', 'revoked', 'expired'];
const DAY_MS = 24 * 60 * 60 * 1000;

function tsToIso(ts: Timestamp | null | undefined): string | null {
  if (!ts) return null;
  if (typeof (ts as unknown as { toDate?: () => Date }).toDate === 'function') {
    return (ts as unknown as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof ts.toMillis === 'function') {
    return new Date(ts.toMillis()).toISOString();
  }
  return null;
}

function tsToMs(ts: Timestamp | null | undefined): number | null {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  if (typeof (ts as unknown as { toDate?: () => Date }).toDate === 'function') {
    return (ts as unknown as { toDate: () => Date }).toDate().getTime();
  }
  return null;
}

export function serializeLicense(keyHash: string, doc: StoredLicenseDoc): SerializedLicense {
  return {
    keyHash,
    keyHashPrefix: getKeyHashPrefix(keyHash),
    plan: doc.plan,
    billing: doc.billing,
    status: doc.status,
    issuedAt: tsToIso(doc.issuedAt) ?? new Date(0).toISOString(),
    expiresAt: tsToIso(doc.expiresAt),
    maxDevices: doc.maxDevices,
    buyerContact: doc.buyerContact ?? '',
    notes: doc.notes ?? '',
    devices: Array.isArray(doc.devices)
      ? doc.devices.map((d) => ({
          deviceId: String(d.deviceId ?? ''),
          label: String(d.label ?? 'Unknown device'),
          activatedAt: tsToIso(d.activatedAt) ?? new Date(0).toISOString(),
          lastSeenAt: tsToIso(d.lastSeenAt) ?? new Date(0).toISOString(),
        }))
      : [],
    revokedReason: doc.revokedReason ?? null,
    revokedAt: tsToIso(doc.revokedAt ?? null),
    reissuedToPrefix: doc.reissuedToPrefix ?? null,
    reissuedFromPrefix: doc.reissuedFromPrefix ?? null,
    updatedAt: tsToIso(doc.updatedAt ?? null),
  };
}

function assertValidKeyHash(keyHash: unknown): string {
  if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) {
    throw new HttpsError('invalid-argument', 'A valid 64-character hex keyHash is required.');
  }
  return keyHash;
}

function assertPlan(plan: unknown): LicensePlan {
  if (typeof plan !== 'string' || !VALID_PLANS.includes(plan as LicensePlan)) {
    throw new HttpsError('invalid-argument', 'Plan must be one of: free, pro, business.');
  }
  return plan as LicensePlan;
}

function assertBilling(billing: unknown): LicenseBilling {
  if (typeof billing !== 'string' || !VALID_BILLINGS.includes(billing as LicenseBilling)) {
    throw new HttpsError('invalid-argument', 'Billing must be one of: monthly, yearly, lifetime.');
  }
  return billing as LicenseBilling;
}

function sanitizeString(value: unknown, maxLen: number, fieldName: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${fieldName} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new HttpsError('invalid-argument', `${fieldName} must be ${maxLen} characters or fewer.`);
  }
  return trimmed;
}

function parseMaxDevices(value: unknown, plan: LicensePlan): number {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_MAX_DEVICES[plan];
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new HttpsError('invalid-argument', 'maxDevices must be an integer between 1 and 100.');
  }
  return value;
}

function parseOptionalExpiresAt(value: unknown, billing: LicenseBilling, nowMs: number): number | null {
  if (value === undefined) {
    if (billing === 'lifetime') return null;
    if (billing === 'monthly') return nowMs + 30 * DAY_MS;
    return nowMs + 365 * DAY_MS;
  }
  if (value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', 'expiresAt must be an ISO 8601 date string or null.');
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new HttpsError('invalid-argument', 'expiresAt is not a valid ISO date.');
  }
  if (parsed <= nowMs) {
    throw new HttpsError('invalid-argument', 'expiresAt must be in the future.');
  }
  return parsed;
}

async function authorizeAndLimit(
  ctx: HandlerContext,
  bucket: 'standard' | 'mint' = 'standard'
): Promise<{ actor: AdminActor; nowMs: number }> {
  const actor = assertAdmin(ctx.auth);
  const nowMs = ctx.nowMs ?? Date.now();
  if (!ctx.skipRateLimit) {
    await checkRateLimit(ctx.db, actor.uid, bucket, nowMs, undefined, ctx.makeTimestamp);
  }
  return { actor, nowMs };
}

function sanitizeCsvCell(value: string | number | null | undefined): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

// =============================================================================
// 1. createLicense
// =============================================================================
export interface CreateLicenseInput {
  plan: LicensePlan;
  billing: LicenseBilling;
  expiresAt?: string | null;
  maxDevices?: number;
  buyerContact?: string;
  notes?: string;
}

export async function createLicenseHandler(ctx: HandlerContext, input: CreateLicenseInput) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'mint');

  const plan = assertPlan(input?.plan);
  const billing = assertBilling(input?.billing);
  const maxDevices = parseMaxDevices(input?.maxDevices, plan);
  const expiresAtMs = parseOptionalExpiresAt(input?.expiresAt, billing, nowMs);
  const buyerContact = sanitizeString(input?.buyerContact, 200, 'buyerContact');
  const notes = sanitizeString(input?.notes, 1000, 'notes');

  const nowTs = ctx.makeTimestamp(nowMs);
  const expiresTs = expiresAtMs !== null ? ctx.makeTimestamp(expiresAtMs) : null;

  // Retry on theoretical hash collision
  let plainKey = '';
  let keyHash = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    plainKey = generateLicenseKey(plan);
    keyHash = hashLicenseKey(plainKey, ctx.pepper);
    const existingSnap = await ctx.db.collection('licenses').doc(keyHash).get();
    if (!existingSnap.exists) {
      break;
    }
    if (attempt === 4) {
      throw new HttpsError('internal', 'Failed to allocate a unique license key hash.');
    }
  }

  const docData: StoredLicenseDoc = {
    plan,
    billing,
    status: 'active',
    issuedAt: nowTs,
    expiresAt: expiresTs,
    maxDevices,
    buyerContact,
    notes,
    devices: [],
    revokedReason: null,
    revokedAt: null,
    reissuedToPrefix: null,
    reissuedFromPrefix: null,
    updatedAt: nowTs,
  };

  await ctx.db.collection('licenses').doc(keyHash).set(docData);

  const keyHashPrefix = getKeyHashPrefix(keyHash);
  const serialized = serializeLicense(keyHash, docData);

  await writeAuditLog(ctx.db, {
    action: 'createLicense',
    actor,
    targetKeyHashPrefix: keyHashPrefix,
    details: `Issued ${plan} (${billing}), maxDevices=${maxDevices}${buyerContact ? `, buyer=${buyerContact}` : ''}`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  const telegramMessages = buildTelegramMessages({
    plan,
    billing,
    plainKey,
    expiresAtIso: serialized.expiresAt,
    maxDevices,
  });

  return {
    keyHash,
    keyHashPrefix,
    plainKey,
    license: serialized,
    telegramMessages,
  };
}

// =============================================================================
// 2. listLicenses
// =============================================================================
export interface ListLicensesInput {
  query?: string;
  status?: LicenseStatus | 'all';
  plan?: LicensePlan | 'all';
  cursor?: string | null;
  limit?: number;
}

export async function listLicensesHandler(ctx: HandlerContext, input: ListLicensesInput = {}) {
  await authorizeAndLimit(ctx, 'standard');

  const rawQuery = sanitizeString(input.query, 120, 'query').toLowerCase();
  const statusFilter = input.status && input.status !== 'all' ? input.status : null;
  const planFilter = input.plan && input.plan !== 'all' ? input.plan : null;

  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    throw new HttpsError('invalid-argument', 'Invalid status filter.');
  }
  if (planFilter && !VALID_PLANS.includes(planFilter)) {
    throw new HttpsError('invalid-argument', 'Invalid plan filter.');
  }

  const pageSize =
    typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
      ? input.limit
      : 25;

  let q = ctx.db.collection('licenses').orderBy('issuedAt', 'desc');
  if (statusFilter) {
    q = q.where('status', '==', statusFilter);
  }
  if (planFilter) {
    q = q.where('plan', '==', planFilter);
  }
  if (typeof input.cursor === 'string' && input.cursor.length > 0) {
    const cursorSnap = await ctx.db.collection('licenses').doc(input.cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap);
    }
  }

  // Fetch a slightly larger batch when text search is active so we can fill a page cleanly
  const fetchLimit = rawQuery ? Math.min(pageSize * 8, 300) : pageSize + 1;
  const snap = await q.limit(fetchLimit).get();

  const items: SerializedLicense[] = [];
  let lastScannedId: string | null = null;
  let hasMore = false;

  for (let i = 0; i < snap.docs.length; i++) {
    const docSnap = snap.docs[i];
    const data = docSnap.data() as StoredLicenseDoc;
    const serialized = serializeLicense(docSnap.id, data);

    const matchesQuery =
      !rawQuery ||
      serialized.keyHash.toLowerCase().startsWith(rawQuery) ||
      serialized.buyerContact.toLowerCase().includes(rawQuery) ||
      serialized.notes.toLowerCase().includes(rawQuery);

    if (matchesQuery) {
      if (items.length < pageSize) {
        items.push(serialized);
        lastScannedId = docSnap.id;
      } else {
        hasMore = true;
        break;
      }
    } else if (!rawQuery && i >= pageSize) {
      hasMore = true;
      break;
    }
  }

  if (!rawQuery && snap.docs.length > pageSize) {
    hasMore = true;
  }

  return {
    items,
    nextCursor: hasMore ? lastScannedId : null,
  };
}

// =============================================================================
// 3. getLicense
// =============================================================================
export async function getLicenseHandler(ctx: HandlerContext, input: { keyHash: string }) {
  await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);
  const snap = await ctx.db.collection('licenses').doc(keyHash).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }
  return {
    license: serializeLicense(snap.id, snap.data() as StoredLicenseDoc),
  };
}

// =============================================================================
// 3b. getDashboardSummary
// =============================================================================
export async function getDashboardSummaryHandler(ctx: HandlerContext) {
  const { nowMs } = await authorizeAndLimit(ctx, 'standard');
  const in14DaysMs = nowMs + 14 * DAY_MS;

  const snap = await ctx.db.collection('licenses').orderBy('issuedAt', 'desc').limit(1000).get();

  const byStatus: Record<LicenseStatus, number> = { active: 0, revoked: 0, expired: 0 };
  const byPlan: Record<LicensePlan, number> = { free: 0, pro: 0, business: 0 };
  const expiringNext14Days: SerializedLicense[] = [];
  const activations: Array<{
    keyHash: string;
    keyHashPrefix: string;
    plan: LicensePlan;
    buyerContact: string;
    deviceId: string;
    label: string;
    activatedAt: string;
    activatedAtMs: number;
  }> = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data() as StoredLicenseDoc;
    const serialized = serializeLicense(docSnap.id, data);

    if (data.status in byStatus) byStatus[data.status] += 1;
    if (data.plan in byPlan) byPlan[data.plan] += 1;

    const expMs = tsToMs(data.expiresAt);
    if (data.status === 'active' && expMs !== null && expMs > nowMs && expMs <= in14DaysMs) {
      expiringNext14Days.push(serialized);
    }

    if (Array.isArray(data.devices)) {
      for (const dev of data.devices) {
        const actMs = tsToMs(dev.activatedAt) ?? 0;
        activations.push({
          keyHash: docSnap.id,
          keyHashPrefix: getKeyHashPrefix(docSnap.id),
          plan: data.plan,
          buyerContact: data.buyerContact ?? '',
          deviceId: dev.deviceId,
          label: dev.label,
          activatedAt: tsToIso(dev.activatedAt) ?? new Date(0).toISOString(),
          activatedAtMs: actMs,
        });
      }
    }
  }

  expiringNext14Days.sort((a, b) => {
    const aMs = a.expiresAt ? Date.parse(a.expiresAt) : Infinity;
    const bMs = b.expiresAt ? Date.parse(b.expiresAt) : Infinity;
    return aMs - bMs;
  });

  activations.sort((a, b) => b.activatedAtMs - a.activatedAtMs);

  return {
    total: snap.docs.length,
    byStatus,
    byPlan,
    expiringNext14Days: expiringNext14Days.slice(0, 20),
    recentActivations: activations.slice(0, 15).map(({ activatedAtMs: _ignore, ...rest }) => rest),
  };
}

// =============================================================================
// 4. Mutation actions: extendLicense, changePlan, revokeLicense, reinstateLicense,
//    resetDevices, removeDevice, reissueLicense
// =============================================================================
export interface ExtendLicenseInput {
  keyHash: string;
  newExpiresAt?: string | null;
  addDays?: number;
}

export async function extendLicenseHandler(ctx: HandlerContext, input: ExtendLicenseInput) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);

  const hasNewExpires = input?.newExpiresAt !== undefined;
  const hasAddDays = input?.addDays !== undefined;
  if (!hasNewExpires && !hasAddDays) {
    throw new HttpsError('invalid-argument', 'Provide either newExpiresAt or addDays.');
  }

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  if (existing.status === 'revoked') {
    throw new HttpsError('failed-precondition', 'Cannot extend a revoked license. Reinstate it first.');
  }

  let nextExpiresMs: number | null = null;
  let billing = existing.billing;

  if (hasAddDays) {
    if (
      typeof input.addDays !== 'number' ||
      !Number.isInteger(input.addDays) ||
      input.addDays < 1 ||
      input.addDays > 3650
    ) {
      throw new HttpsError('invalid-argument', 'addDays must be an integer between 1 and 3650.');
    }
    const existingExpMs = tsToMs(existing.expiresAt);
    if (existingExpMs === null) {
      throw new HttpsError('failed-precondition', 'Lifetime licenses already have no expiration date.');
    }
    const baseMs = Math.max(existingExpMs, nowMs);
    nextExpiresMs = baseMs + input.addDays * DAY_MS;
  } else if (input.newExpiresAt === null) {
    nextExpiresMs = null;
    billing = 'lifetime';
  } else {
    const parsed = Date.parse(String(input.newExpiresAt));
    if (Number.isNaN(parsed) || parsed <= nowMs) {
      throw new HttpsError('invalid-argument', 'newExpiresAt must be a valid future ISO date.');
    }
    nextExpiresMs = parsed;
  }

  const nextStatus: LicenseStatus =
    nextExpiresMs === null || nextExpiresMs > nowMs ? 'active' : 'expired';
  const nowTs = ctx.makeTimestamp(nowMs);
  const nextExpiresTs = nextExpiresMs !== null ? ctx.makeTimestamp(nextExpiresMs) : null;

  await ref.update({
    expiresAt: nextExpiresTs,
    billing,
    status: nextStatus,
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    expiresAt: nextExpiresTs,
    billing,
    status: nextStatus,
    updatedAt: nowTs,
  };
  const serialized = serializeLicense(keyHash, updatedDoc);

  await writeAuditLog(ctx.db, {
    action: 'extendLicense',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: hasAddDays
      ? `Extended by +${input.addDays} days (new expiresAt=${serialized.expiresAt ?? 'lifetime'})`
      : `Set expiresAt=${serialized.expiresAt ?? 'lifetime'}`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serialized };
}

export async function changePlanHandler(
  ctx: HandlerContext,
  input: { keyHash: string; plan: LicensePlan; maxDevices?: number }
) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);
  const plan = assertPlan(input?.plan);
  const maxDevices = parseMaxDevices(input?.maxDevices, plan);

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  const nowTs = ctx.makeTimestamp(nowMs);

  await ref.update({
    plan,
    maxDevices,
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    plan,
    maxDevices,
    updatedAt: nowTs,
  };

  await writeAuditLog(ctx.db, {
    action: 'changePlan',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: `Changed plan ${existing.plan} -> ${plan}, maxDevices=${maxDevices}`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serializeLicense(keyHash, updatedDoc) };
}

export async function revokeLicenseHandler(
  ctx: HandlerContext,
  input: { keyHash: string; reason: string }
) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);
  const reason = sanitizeString(input?.reason, 500, 'reason');
  if (!reason) {
    throw new HttpsError('invalid-argument', 'A revocation reason is required.');
  }

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  const nowTs = ctx.makeTimestamp(nowMs);

  await ref.update({
    status: 'revoked',
    revokedReason: reason,
    revokedAt: nowTs,
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    status: 'revoked',
    revokedReason: reason,
    revokedAt: nowTs,
    updatedAt: nowTs,
  };

  await writeAuditLog(ctx.db, {
    action: 'revokeLicense',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: `Revoked license: ${reason}`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serializeLicense(keyHash, updatedDoc) };
}

export async function reinstateLicenseHandler(ctx: HandlerContext, input: { keyHash: string }) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  const expMs = tsToMs(existing.expiresAt);
  if (expMs !== null && expMs <= nowMs) {
    throw new HttpsError(
      'failed-precondition',
      'License expiration date has already passed. Extend the expiry date to reactivate.'
    );
  }

  const nowTs = ctx.makeTimestamp(nowMs);
  await ref.update({
    status: 'active',
    revokedReason: null,
    revokedAt: null,
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    status: 'active',
    revokedReason: null,
    revokedAt: null,
    updatedAt: nowTs,
  };

  await writeAuditLog(ctx.db, {
    action: 'reinstateLicense',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: 'Reinstated license to active status',
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serializeLicense(keyHash, updatedDoc) };
}

export async function resetDevicesHandler(ctx: HandlerContext, input: { keyHash: string }) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  const previousCount = Array.isArray(existing.devices) ? existing.devices.length : 0;
  const nowTs = ctx.makeTimestamp(nowMs);

  await ref.update({
    devices: [],
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    devices: [],
    updatedAt: nowTs,
  };

  await writeAuditLog(ctx.db, {
    action: 'resetDevices',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: `Cleared ${previousCount} bound device(s)`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serializeLicense(keyHash, updatedDoc) };
}

export async function removeDeviceHandler(
  ctx: HandlerContext,
  input: { keyHash: string; deviceId: string }
) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
  const keyHash = assertValidKeyHash(input?.keyHash);
  const deviceId = sanitizeString(input?.deviceId, 200, 'deviceId');
  if (!deviceId) {
    throw new HttpsError('invalid-argument', 'deviceId is required.');
  }

  const ref = ctx.db.collection('licenses').doc(keyHash);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const existing = snap.data() as StoredLicenseDoc;
  const devices = Array.isArray(existing.devices) ? existing.devices : [];
  const nextDevices = devices.filter((d) => d.deviceId !== deviceId);
  if (nextDevices.length === devices.length) {
    throw new HttpsError('not-found', 'Device not found on this license.');
  }

  const nowTs = ctx.makeTimestamp(nowMs);
  await ref.update({
    devices: nextDevices,
    updatedAt: nowTs,
  });

  const updatedDoc: StoredLicenseDoc = {
    ...existing,
    devices: nextDevices,
    updatedAt: nowTs,
  };

  await writeAuditLog(ctx.db, {
    action: 'removeDevice',
    actor,
    targetKeyHashPrefix: getKeyHashPrefix(keyHash),
    details: `Removed device ${deviceId}`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return { license: serializeLicense(keyHash, updatedDoc) };
}

export async function reissueLicenseHandler(
  ctx: HandlerContext,
  input: { keyHash: string; reason?: string }
) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'mint');
  const oldKeyHash = assertValidKeyHash(input?.keyHash);
  const customReason = sanitizeString(input?.reason, 400, 'reason');

  const oldRef = ctx.db.collection('licenses').doc(oldKeyHash);
  const oldSnap = await oldRef.get();
  if (!oldSnap.exists) {
    throw new HttpsError('not-found', 'License not found.');
  }

  const oldDoc = oldSnap.data() as StoredLicenseDoc;
  const oldExpMs = tsToMs(oldDoc.expiresAt);
  if (oldExpMs !== null && oldExpMs <= nowMs) {
    throw new HttpsError(
      'failed-precondition',
      'Cannot reissue an already expired license without extending it first.'
    );
  }

  let plainKey = '';
  let newKeyHash = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    plainKey = generateLicenseKey(oldDoc.plan);
    newKeyHash = hashLicenseKey(plainKey, ctx.pepper);
    const collisionSnap = await ctx.db.collection('licenses').doc(newKeyHash).get();
    if (!collisionSnap.exists) break;
    if (attempt === 4) {
      throw new HttpsError('internal', 'Failed to allocate a unique replacement key.');
    }
  }

  const oldPrefix = getKeyHashPrefix(oldKeyHash);
  const newPrefix = getKeyHashPrefix(newKeyHash);
  const nowTs = ctx.makeTimestamp(nowMs);
  const revokeReason = customReason || `Reissued to ${newPrefix}`;

  const newDoc: StoredLicenseDoc = {
    plan: oldDoc.plan,
    billing: oldDoc.billing,
    status: 'active',
    issuedAt: nowTs,
    expiresAt: oldDoc.expiresAt,
    maxDevices: oldDoc.maxDevices,
    buyerContact: oldDoc.buyerContact ?? '',
    notes: oldDoc.notes ?? '',
    devices: [],
    revokedReason: null,
    revokedAt: null,
    reissuedToPrefix: null,
    reissuedFromPrefix: oldPrefix,
    updatedAt: nowTs,
  };

  const newRef = ctx.db.collection('licenses').doc(newKeyHash);

  await ctx.db.runTransaction(async (tx) => {
    const freshOld = await tx.get(oldRef);
    if (!freshOld.exists) {
      throw new HttpsError('not-found', 'License not found.');
    }
    tx.set(newRef, newDoc);
    tx.update(oldRef, {
      status: 'revoked',
      revokedReason: revokeReason,
      revokedAt: nowTs,
      reissuedToPrefix: newPrefix,
      updatedAt: nowTs,
    });
  });

  const serializedNew = serializeLicense(newKeyHash, newDoc);

  await writeAuditLog(ctx.db, {
    action: 'reissueLicense',
    actor,
    targetKeyHashPrefix: newPrefix,
    details: `Reissued from ${oldPrefix} (${oldDoc.plan}/${oldDoc.billing}); old key revoked`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  const telegramMessages = buildTelegramMessages({
    plan: oldDoc.plan,
    billing: oldDoc.billing,
    plainKey,
    expiresAtIso: serializedNew.expiresAt,
    maxDevices: oldDoc.maxDevices,
  });

  return {
    oldKeyHash,
    newKeyHash,
    keyHashPrefix: newPrefix,
    plainKey,
    license: serializedNew,
    telegramMessages,
  };
}

// =============================================================================
// 5. exportLicensesCsv
// =============================================================================
export async function exportLicensesCsvHandler(
  ctx: HandlerContext,
  input: { status?: LicenseStatus | 'all'; plan?: LicensePlan | 'all' } = {}
) {
  const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');

  const statusFilter = input.status && input.status !== 'all' ? input.status : null;
  const planFilter = input.plan && input.plan !== 'all' ? input.plan : null;

  if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
    throw new HttpsError('invalid-argument', 'Invalid status filter.');
  }
  if (planFilter && !VALID_PLANS.includes(planFilter)) {
    throw new HttpsError('invalid-argument', 'Invalid plan filter.');
  }

  let q = ctx.db.collection('licenses').orderBy('issuedAt', 'desc');
  if (statusFilter) q = q.where('status', '==', statusFilter);
  if (planFilter) q = q.where('plan', '==', planFilter);

  const snap = await q.limit(5000).get();

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

  const rows = snap.docs.map((docSnap) => {
    const s = serializeLicense(docSnap.id, docSnap.data() as StoredLicenseDoc);
    return [
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
    ].join(',');
  });

  await writeAuditLog(ctx.db, {
    action: 'exportLicensesCsv',
    actor,
    targetKeyHashPrefix: 'batch',
    details: `Exported ${rows.length} license row(s) (status=${statusFilter ?? 'all'}, plan=${planFilter ?? 'all'})`,
    nowMs,
    makeTimestamp: ctx.makeTimestamp,
  });

  return {
    csv: [header, ...rows].join('\n'),
    count: rows.length,
  };
}

// =============================================================================
// 6. listAuditLogs
// =============================================================================
export async function listAuditLogsHandler(
  ctx: HandlerContext,
  input: { action?: string; cursor?: string | null; limit?: number } = {}
) {
  await authorizeAndLimit(ctx, 'standard');

  const actionFilter = sanitizeString(input.action, 64, 'action');
  const pageSize =
    typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
      ? input.limit
      : 30;

  let q = ctx.db.collection('adminAuditLog').orderBy('createdAt', 'desc');
  if (actionFilter && actionFilter !== 'all') {
    q = q.where('action', '==', actionFilter);
  }
  if (typeof input.cursor === 'string' && input.cursor.length > 0) {
    const cursorSnap = await ctx.db.collection('adminAuditLog').doc(input.cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap);
    }
  }

  const snap = await q.limit(pageSize + 1).get();
  const hasMore = snap.docs.length > pageSize;
  const slice = snap.docs.slice(0, pageSize);

  const items = slice.map((d) => {
    const data = d.data() as {
      action: string;
      actorUid: string;
      actorEmail: string;
      targetKeyHashPrefix: string;
      details: string;
      createdAt: Timestamp;
    };
    return {
      id: d.id,
      action: data.action,
      actorUid: data.actorUid,
      actorEmail: data.actorEmail,
      targetKeyHashPrefix: data.targetKeyHashPrefix,
      details: data.details,
      createdAt: tsToIso(data.createdAt) ?? new Date(0).toISOString(),
    };
  });

  return {
    items,
    nextCursor: hasMore ? slice[slice.length - 1].id : null,
  };
}

// =============================================================================
// 7. Scheduled expiry processor
// =============================================================================
export async function expireOverdueLicensesHandler(params: {
  db: Firestore;
  nowMs?: number;
  makeTimestamp: (ms: number) => Timestamp;
}): Promise<{ expiredCount: number }> {
  const nowMs = params.nowMs ?? Date.now();
  const nowTs = params.makeTimestamp(nowMs);

  const overdueSnap = await params.db
    .collection('licenses')
    .where('status', '==', 'active')
    .where('expiresAt', '<=', nowTs)
    .get();

  let expiredCount = 0;
  const docsToExpire = overdueSnap.docs.filter((docSnap) => {
    const data = docSnap.data() as StoredLicenseDoc;
    const expMs = tsToMs(data.expiresAt);
    return expMs !== null && expMs <= nowMs;
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < docsToExpire.length; i += CHUNK_SIZE) {
    const chunk = docsToExpire.slice(i, i + CHUNK_SIZE);
    const batch = params.db.batch();
    for (const docSnap of chunk) {
      batch.update(docSnap.ref, {
        status: 'expired',
        updatedAt: nowTs,
      });
      expiredCount += 1;
    }
    await batch.commit();
  }

  if (expiredCount > 0) {
    await writeAuditLog(params.db, {
      action: 'expireOverdueLicenses',
      actor: { uid: 'system:scheduler', email: 'scheduler@system' },
      targetKeyHashPrefix: 'batch',
      details: `Marked ${expiredCount} overdue license(s) as expired`,
      nowMs,
      makeTimestamp: params.makeTimestamp,
    });
  }

  return { expiredCount };
}
