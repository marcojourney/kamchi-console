"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEY_MINT_RATE_LIMIT = exports.DEFAULT_RATE_LIMIT = void 0;
exports.assertAdmin = assertAdmin;
exports.checkRateLimit = checkRateLimit;
exports.writeAuditLog = writeAuditLog;
const https_1 = require("firebase-functions/v2/https");
exports.DEFAULT_RATE_LIMIT = {
    windowMs: 60_000,
    maxRequests: 60,
};
exports.KEY_MINT_RATE_LIMIT = {
    windowMs: 60_000,
    maxRequests: 20,
};
/**
 * Verifies Firebase Auth context, verified email, and `admin === true` custom claim.
 * Never trusts client-supplied fields.
 */
function assertAdmin(auth) {
    if (!auth) {
        throw new https_1.HttpsError('unauthenticated', 'Authentication required. Sign in with Google.');
    }
    const token = auth.token;
    if (!token || token.email_verified !== true) {
        throw new https_1.HttpsError('permission-denied', 'A verified Google account email is required.');
    }
    if (token.admin !== true) {
        throw new https_1.HttpsError('permission-denied', 'Admin privileges (admin=true claim) are required.');
    }
    return {
        uid: auth.uid,
        email: typeof token.email === 'string' ? token.email : 'unknown-admin',
    };
}
/**
 * Enforces a per-admin fixed-window rate limit stored in `adminRateLimits/{bucketKey}`.
 */
async function checkRateLimit(db, uid, bucket, nowMs = Date.now(), config = bucket === 'mint' ? exports.KEY_MINT_RATE_LIMIT : exports.DEFAULT_RATE_LIMIT, makeTimestamp = (ms) => ({ toMillis: () => ms })) {
    const docId = `${uid}_${bucket}`;
    const ref = db.collection('adminRateLimits').doc(docId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists ? snap.data() : null;
        if (!data || typeof data.windowStartMs !== 'number' || nowMs - data.windowStartMs >= config.windowMs) {
            tx.set(ref, {
                windowStartMs: nowMs,
                count: 1,
                updatedAt: makeTimestamp(nowMs),
            });
            return;
        }
        const nextCount = (data.count ?? 0) + 1;
        if (nextCount > config.maxRequests) {
            throw new https_1.HttpsError('resource-exhausted', 'Rate limit exceeded for admin actions. Please wait a minute before trying again.');
        }
        tx.set(ref, {
            windowStartMs: data.windowStartMs,
            count: nextCount,
            updatedAt: makeTimestamp(nowMs),
        });
    });
}
/**
 * Appends an immutable audit entry to `adminAuditLog`.
 * Never logs plain license keys or any loan data.
 */
async function writeAuditLog(db, entry) {
    const nowMs = entry.nowMs ?? Date.now();
    const ts = entry.makeTimestamp ? entry.makeTimestamp(nowMs) : { toMillis: () => nowMs };
    await db.collection('adminAuditLog').add({
        action: entry.action.slice(0, 64),
        actorUid: entry.actor.uid.slice(0, 128),
        actorEmail: entry.actor.email.slice(0, 254),
        targetKeyHashPrefix: entry.targetKeyHashPrefix.slice(0, 16),
        details: entry.details.slice(0, 1000),
        createdAt: ts,
    });
}
//# sourceMappingURL=security.js.map