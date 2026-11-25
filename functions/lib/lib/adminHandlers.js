"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeLicense = serializeLicense;
exports.createLicenseHandler = createLicenseHandler;
exports.listLicensesHandler = listLicensesHandler;
exports.getLicenseHandler = getLicenseHandler;
exports.getDashboardSummaryHandler = getDashboardSummaryHandler;
exports.extendLicenseHandler = extendLicenseHandler;
exports.changePlanHandler = changePlanHandler;
exports.revokeLicenseHandler = revokeLicenseHandler;
exports.reinstateLicenseHandler = reinstateLicenseHandler;
exports.resetDevicesHandler = resetDevicesHandler;
exports.removeDeviceHandler = removeDeviceHandler;
exports.reissueLicenseHandler = reissueLicenseHandler;
exports.exportLicensesCsvHandler = exportLicensesCsvHandler;
exports.listAuditLogsHandler = listAuditLogsHandler;
exports.expireOverdueLicensesHandler = expireOverdueLicensesHandler;
const https_1 = require("firebase-functions/v2/https");
const licenseKey_js_1 = require("./licenseKey.js");
const security_js_1 = require("./security.js");
const telegramMessages_js_1 = require("./telegramMessages.js");
const VALID_PLANS = ['free', 'pro', 'business'];
const VALID_BILLINGS = ['monthly', 'yearly', 'lifetime'];
const VALID_STATUSES = ['active', 'revoked', 'expired'];
const DAY_MS = 24 * 60 * 60 * 1000;
function tsToIso(ts) {
    if (!ts)
        return null;
    if (typeof ts.toDate === 'function') {
        return ts.toDate().toISOString();
    }
    if (typeof ts.toMillis === 'function') {
        return new Date(ts.toMillis()).toISOString();
    }
    return null;
}
function tsToMs(ts) {
    if (!ts)
        return null;
    if (typeof ts.toMillis === 'function') {
        return ts.toMillis();
    }
    if (typeof ts.toDate === 'function') {
        return ts.toDate().getTime();
    }
    return null;
}
function serializeLicense(keyHash, doc) {
    return {
        keyHash,
        keyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
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
function assertValidKeyHash(keyHash) {
    if (typeof keyHash !== 'string' || !/^[a-f0-9]{64}$/.test(keyHash)) {
        throw new https_1.HttpsError('invalid-argument', 'A valid 64-character hex keyHash is required.');
    }
    return keyHash;
}
function assertPlan(plan) {
    if (typeof plan !== 'string' || !VALID_PLANS.includes(plan)) {
        throw new https_1.HttpsError('invalid-argument', 'Plan must be one of: free, pro, business.');
    }
    return plan;
}
function assertBilling(billing) {
    if (typeof billing !== 'string' || !VALID_BILLINGS.includes(billing)) {
        throw new https_1.HttpsError('invalid-argument', 'Billing must be one of: monthly, yearly, lifetime.');
    }
    return billing;
}
function sanitizeString(value, maxLen, fieldName) {
    if (value === undefined || value === null)
        return '';
    if (typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', `${fieldName} must be a string.`);
    }
    const trimmed = value.trim();
    if (trimmed.length > maxLen) {
        throw new https_1.HttpsError('invalid-argument', `${fieldName} must be ${maxLen} characters or fewer.`);
    }
    return trimmed;
}
function parseMaxDevices(value, plan) {
    if (value === undefined || value === null || value === '') {
        return licenseKey_js_1.DEFAULT_MAX_DEVICES[plan];
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
        throw new https_1.HttpsError('invalid-argument', 'maxDevices must be an integer between 1 and 100.');
    }
    return value;
}
function parseOptionalExpiresAt(value, billing, nowMs) {
    if (value === undefined) {
        if (billing === 'lifetime')
            return null;
        if (billing === 'monthly')
            return nowMs + 30 * DAY_MS;
        return nowMs + 365 * DAY_MS;
    }
    if (value === null || value === '') {
        return null;
    }
    if (typeof value !== 'string') {
        throw new https_1.HttpsError('invalid-argument', 'expiresAt must be an ISO 8601 date string or null.');
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) {
        throw new https_1.HttpsError('invalid-argument', 'expiresAt is not a valid ISO date.');
    }
    if (parsed <= nowMs) {
        throw new https_1.HttpsError('invalid-argument', 'expiresAt must be in the future.');
    }
    return parsed;
}
async function authorizeAndLimit(ctx, bucket = 'standard') {
    const actor = (0, security_js_1.assertAdmin)(ctx.auth);
    const nowMs = ctx.nowMs ?? Date.now();
    if (!ctx.skipRateLimit) {
        await (0, security_js_1.checkRateLimit)(ctx.db, actor.uid, bucket, nowMs, undefined, ctx.makeTimestamp);
    }
    return { actor, nowMs };
}
function sanitizeCsvCell(value) {
    const raw = value === null || value === undefined ? '' : String(value);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    if (/[",\n\r]/.test(safe)) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}
async function createLicenseHandler(ctx, input) {
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
        plainKey = (0, licenseKey_js_1.generateLicenseKey)(plan);
        keyHash = (0, licenseKey_js_1.hashLicenseKey)(plainKey, ctx.pepper);
        const existingSnap = await ctx.db.collection('licenses').doc(keyHash).get();
        if (!existingSnap.exists) {
            break;
        }
        if (attempt === 4) {
            throw new https_1.HttpsError('internal', 'Failed to allocate a unique license key hash.');
        }
    }
    const docData = {
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
    const keyHashPrefix = (0, licenseKey_js_1.getKeyHashPrefix)(keyHash);
    const serialized = serializeLicense(keyHash, docData);
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'createLicense',
        actor,
        targetKeyHashPrefix: keyHashPrefix,
        details: `Issued ${plan} (${billing}), maxDevices=${maxDevices}${buyerContact ? `, buyer=${buyerContact}` : ''}`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    const telegramMessages = (0, telegramMessages_js_1.buildTelegramMessages)({
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
async function listLicensesHandler(ctx, input = {}) {
    await authorizeAndLimit(ctx, 'standard');
    const rawQuery = sanitizeString(input.query, 120, 'query').toLowerCase();
    const statusFilter = input.status && input.status !== 'all' ? input.status : null;
    const planFilter = input.plan && input.plan !== 'all' ? input.plan : null;
    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid status filter.');
    }
    if (planFilter && !VALID_PLANS.includes(planFilter)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid plan filter.');
    }
    const pageSize = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
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
    const items = [];
    let lastScannedId = null;
    let hasMore = false;
    for (let i = 0; i < snap.docs.length; i++) {
        const docSnap = snap.docs[i];
        const data = docSnap.data();
        const serialized = serializeLicense(docSnap.id, data);
        const matchesQuery = !rawQuery ||
            serialized.keyHash.toLowerCase().startsWith(rawQuery) ||
            serialized.buyerContact.toLowerCase().includes(rawQuery) ||
            serialized.notes.toLowerCase().includes(rawQuery);
        if (matchesQuery) {
            if (items.length < pageSize) {
                items.push(serialized);
                lastScannedId = docSnap.id;
            }
            else {
                hasMore = true;
                break;
            }
        }
        else if (!rawQuery && i >= pageSize) {
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
async function getLicenseHandler(ctx, input) {
    await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const snap = await ctx.db.collection('licenses').doc(keyHash).get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    return {
        license: serializeLicense(snap.id, snap.data()),
    };
}
// =============================================================================
// 3b. getDashboardSummary
// =============================================================================
async function getDashboardSummaryHandler(ctx) {
    const { nowMs } = await authorizeAndLimit(ctx, 'standard');
    const in14DaysMs = nowMs + 14 * DAY_MS;
    const snap = await ctx.db.collection('licenses').orderBy('issuedAt', 'desc').limit(1000).get();
    const byStatus = { active: 0, revoked: 0, expired: 0 };
    const byPlan = { free: 0, pro: 0, business: 0 };
    const expiringNext14Days = [];
    const activations = [];
    for (const docSnap of snap.docs) {
        const data = docSnap.data();
        const serialized = serializeLicense(docSnap.id, data);
        if (data.status in byStatus)
            byStatus[data.status] += 1;
        if (data.plan in byPlan)
            byPlan[data.plan] += 1;
        const expMs = tsToMs(data.expiresAt);
        if (data.status === 'active' && expMs !== null && expMs > nowMs && expMs <= in14DaysMs) {
            expiringNext14Days.push(serialized);
        }
        if (Array.isArray(data.devices)) {
            for (const dev of data.devices) {
                const actMs = tsToMs(dev.activatedAt) ?? 0;
                activations.push({
                    keyHash: docSnap.id,
                    keyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(docSnap.id),
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
async function extendLicenseHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const hasNewExpires = input?.newExpiresAt !== undefined;
    const hasAddDays = input?.addDays !== undefined;
    if (!hasNewExpires && !hasAddDays) {
        throw new https_1.HttpsError('invalid-argument', 'Provide either newExpiresAt or addDays.');
    }
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    if (existing.status === 'revoked') {
        throw new https_1.HttpsError('failed-precondition', 'Cannot extend a revoked license. Reinstate it first.');
    }
    let nextExpiresMs = null;
    let billing = existing.billing;
    if (hasAddDays) {
        if (typeof input.addDays !== 'number' ||
            !Number.isInteger(input.addDays) ||
            input.addDays < 1 ||
            input.addDays > 3650) {
            throw new https_1.HttpsError('invalid-argument', 'addDays must be an integer between 1 and 3650.');
        }
        const existingExpMs = tsToMs(existing.expiresAt);
        if (existingExpMs === null) {
            throw new https_1.HttpsError('failed-precondition', 'Lifetime licenses already have no expiration date.');
        }
        const baseMs = Math.max(existingExpMs, nowMs);
        nextExpiresMs = baseMs + input.addDays * DAY_MS;
    }
    else if (input.newExpiresAt === null) {
        nextExpiresMs = null;
        billing = 'lifetime';
    }
    else {
        const parsed = Date.parse(String(input.newExpiresAt));
        if (Number.isNaN(parsed) || parsed <= nowMs) {
            throw new https_1.HttpsError('invalid-argument', 'newExpiresAt must be a valid future ISO date.');
        }
        nextExpiresMs = parsed;
    }
    const nextStatus = nextExpiresMs === null || nextExpiresMs > nowMs ? 'active' : 'expired';
    const nowTs = ctx.makeTimestamp(nowMs);
    const nextExpiresTs = nextExpiresMs !== null ? ctx.makeTimestamp(nextExpiresMs) : null;
    await ref.update({
        expiresAt: nextExpiresTs,
        billing,
        status: nextStatus,
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        expiresAt: nextExpiresTs,
        billing,
        status: nextStatus,
        updatedAt: nowTs,
    };
    const serialized = serializeLicense(keyHash, updatedDoc);
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'extendLicense',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: hasAddDays
            ? `Extended by +${input.addDays} days (new expiresAt=${serialized.expiresAt ?? 'lifetime'})`
            : `Set expiresAt=${serialized.expiresAt ?? 'lifetime'}`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serialized };
}
async function changePlanHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const plan = assertPlan(input?.plan);
    const maxDevices = parseMaxDevices(input?.maxDevices, plan);
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    const nowTs = ctx.makeTimestamp(nowMs);
    await ref.update({
        plan,
        maxDevices,
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        plan,
        maxDevices,
        updatedAt: nowTs,
    };
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'changePlan',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: `Changed plan ${existing.plan} -> ${plan}, maxDevices=${maxDevices}`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serializeLicense(keyHash, updatedDoc) };
}
async function revokeLicenseHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const reason = sanitizeString(input?.reason, 500, 'reason');
    if (!reason) {
        throw new https_1.HttpsError('invalid-argument', 'A revocation reason is required.');
    }
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    const nowTs = ctx.makeTimestamp(nowMs);
    await ref.update({
        status: 'revoked',
        revokedReason: reason,
        revokedAt: nowTs,
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        status: 'revoked',
        revokedReason: reason,
        revokedAt: nowTs,
        updatedAt: nowTs,
    };
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'revokeLicense',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: `Revoked license: ${reason}`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serializeLicense(keyHash, updatedDoc) };
}
async function reinstateLicenseHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    const expMs = tsToMs(existing.expiresAt);
    if (expMs !== null && expMs <= nowMs) {
        throw new https_1.HttpsError('failed-precondition', 'License expiration date has already passed. Extend the expiry date to reactivate.');
    }
    const nowTs = ctx.makeTimestamp(nowMs);
    await ref.update({
        status: 'active',
        revokedReason: null,
        revokedAt: null,
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        status: 'active',
        revokedReason: null,
        revokedAt: null,
        updatedAt: nowTs,
    };
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'reinstateLicense',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: 'Reinstated license to active status',
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serializeLicense(keyHash, updatedDoc) };
}
async function resetDevicesHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    const previousCount = Array.isArray(existing.devices) ? existing.devices.length : 0;
    const nowTs = ctx.makeTimestamp(nowMs);
    await ref.update({
        devices: [],
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        devices: [],
        updatedAt: nowTs,
    };
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'resetDevices',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: `Cleared ${previousCount} bound device(s)`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serializeLicense(keyHash, updatedDoc) };
}
async function removeDeviceHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const keyHash = assertValidKeyHash(input?.keyHash);
    const deviceId = sanitizeString(input?.deviceId, 200, 'deviceId');
    if (!deviceId) {
        throw new https_1.HttpsError('invalid-argument', 'deviceId is required.');
    }
    const ref = ctx.db.collection('licenses').doc(keyHash);
    const snap = await ref.get();
    if (!snap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const existing = snap.data();
    const devices = Array.isArray(existing.devices) ? existing.devices : [];
    const nextDevices = devices.filter((d) => d.deviceId !== deviceId);
    if (nextDevices.length === devices.length) {
        throw new https_1.HttpsError('not-found', 'Device not found on this license.');
    }
    const nowTs = ctx.makeTimestamp(nowMs);
    await ref.update({
        devices: nextDevices,
        updatedAt: nowTs,
    });
    const updatedDoc = {
        ...existing,
        devices: nextDevices,
        updatedAt: nowTs,
    };
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'removeDevice',
        actor,
        targetKeyHashPrefix: (0, licenseKey_js_1.getKeyHashPrefix)(keyHash),
        details: `Removed device ${deviceId}`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    return { license: serializeLicense(keyHash, updatedDoc) };
}
async function reissueLicenseHandler(ctx, input) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'mint');
    const oldKeyHash = assertValidKeyHash(input?.keyHash);
    const customReason = sanitizeString(input?.reason, 400, 'reason');
    const oldRef = ctx.db.collection('licenses').doc(oldKeyHash);
    const oldSnap = await oldRef.get();
    if (!oldSnap.exists) {
        throw new https_1.HttpsError('not-found', 'License not found.');
    }
    const oldDoc = oldSnap.data();
    const oldExpMs = tsToMs(oldDoc.expiresAt);
    if (oldExpMs !== null && oldExpMs <= nowMs) {
        throw new https_1.HttpsError('failed-precondition', 'Cannot reissue an already expired license without extending it first.');
    }
    let plainKey = '';
    let newKeyHash = '';
    for (let attempt = 0; attempt < 5; attempt++) {
        plainKey = (0, licenseKey_js_1.generateLicenseKey)(oldDoc.plan);
        newKeyHash = (0, licenseKey_js_1.hashLicenseKey)(plainKey, ctx.pepper);
        const collisionSnap = await ctx.db.collection('licenses').doc(newKeyHash).get();
        if (!collisionSnap.exists)
            break;
        if (attempt === 4) {
            throw new https_1.HttpsError('internal', 'Failed to allocate a unique replacement key.');
        }
    }
    const oldPrefix = (0, licenseKey_js_1.getKeyHashPrefix)(oldKeyHash);
    const newPrefix = (0, licenseKey_js_1.getKeyHashPrefix)(newKeyHash);
    const nowTs = ctx.makeTimestamp(nowMs);
    const revokeReason = customReason || `Reissued to ${newPrefix}`;
    const newDoc = {
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
            throw new https_1.HttpsError('not-found', 'License not found.');
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
    await (0, security_js_1.writeAuditLog)(ctx.db, {
        action: 'reissueLicense',
        actor,
        targetKeyHashPrefix: newPrefix,
        details: `Reissued from ${oldPrefix} (${oldDoc.plan}/${oldDoc.billing}); old key revoked`,
        nowMs,
        makeTimestamp: ctx.makeTimestamp,
    });
    const telegramMessages = (0, telegramMessages_js_1.buildTelegramMessages)({
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
async function exportLicensesCsvHandler(ctx, input = {}) {
    const { actor, nowMs } = await authorizeAndLimit(ctx, 'standard');
    const statusFilter = input.status && input.status !== 'all' ? input.status : null;
    const planFilter = input.plan && input.plan !== 'all' ? input.plan : null;
    if (statusFilter && !VALID_STATUSES.includes(statusFilter)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid status filter.');
    }
    if (planFilter && !VALID_PLANS.includes(planFilter)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid plan filter.');
    }
    let q = ctx.db.collection('licenses').orderBy('issuedAt', 'desc');
    if (statusFilter)
        q = q.where('status', '==', statusFilter);
    if (planFilter)
        q = q.where('plan', '==', planFilter);
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
        const s = serializeLicense(docSnap.id, docSnap.data());
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
    await (0, security_js_1.writeAuditLog)(ctx.db, {
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
async function listAuditLogsHandler(ctx, input = {}) {
    await authorizeAndLimit(ctx, 'standard');
    const actionFilter = sanitizeString(input.action, 64, 'action');
    const pageSize = typeof input.limit === 'number' && Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= 100
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
        const data = d.data();
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
async function expireOverdueLicensesHandler(params) {
    const nowMs = params.nowMs ?? Date.now();
    const nowTs = params.makeTimestamp(nowMs);
    const overdueSnap = await params.db
        .collection('licenses')
        .where('status', '==', 'active')
        .where('expiresAt', '<=', nowTs)
        .get();
    let expiredCount = 0;
    const docsToExpire = overdueSnap.docs.filter((docSnap) => {
        const data = docSnap.data();
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
        await (0, security_js_1.writeAuditLog)(params.db, {
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
//# sourceMappingURL=adminHandlers.js.map