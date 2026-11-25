import { HttpsError } from 'firebase-functions/v2/https';
import type { Firestore, Timestamp } from 'firebase-admin/firestore';
import type { AuthData } from 'firebase-functions/v2/tasks';

export interface AdminActor {
  uid: string;
  email: string;
}

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 60,
};

export const KEY_MINT_RATE_LIMIT: RateLimitConfig = {
  windowMs: 60_000,
  maxRequests: 20,
};

/**
 * Verifies Firebase Auth context, verified email, and `admin === true` custom claim.
 * Never trusts client-supplied fields.
 */
export function assertAdmin(auth: { uid: string; token: Record<string, unknown> } | AuthData | undefined | null): AdminActor {
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Authentication required. Sign in with Google.');
  }

  const token = auth.token as Record<string, unknown> | undefined;
  if (!token || token.email_verified !== true) {
    throw new HttpsError('permission-denied', 'A verified Google account email is required.');
  }

  if (token.admin !== true) {
    throw new HttpsError('permission-denied', 'Admin privileges (admin=true claim) are required.');
  }

  return {
    uid: auth.uid,
    email: typeof token.email === 'string' ? token.email : 'unknown-admin',
  };
}

/**
 * Enforces a per-admin fixed-window rate limit stored in `adminRateLimits/{bucketKey}`.
 */
export async function checkRateLimit(
  db: Firestore,
  uid: string,
  bucket: 'standard' | 'mint',
  nowMs: number = Date.now(),
  config: RateLimitConfig = bucket === 'mint' ? KEY_MINT_RATE_LIMIT : DEFAULT_RATE_LIMIT,
  makeTimestamp: (ms: number) => Timestamp = (ms) => ({ toMillis: () => ms } as unknown as Timestamp)
): Promise<void> {
  const docId = `${uid}_${bucket}`;
  const ref = db.collection('adminRateLimits').doc(docId);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? (snap.data() as { windowStartMs?: number; count?: number }) : null;

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
      throw new HttpsError(
        'resource-exhausted',
        'Rate limit exceeded for admin actions. Please wait a minute before trying again.'
      );
    }

    tx.set(ref, {
      windowStartMs: data.windowStartMs,
      count: nextCount,
      updatedAt: makeTimestamp(nowMs),
    });
  });
}

export interface AuditLogInput {
  action: string;
  actor: AdminActor;
  targetKeyHashPrefix: string;
  details: string;
  nowMs?: number;
  makeTimestamp?: (ms: number) => Timestamp;
}

/**
 * Appends an immutable audit entry to `adminAuditLog`.
 * Never logs plain license keys or any loan data.
 */
export async function writeAuditLog(db: Firestore, entry: AuditLogInput): Promise<void> {
  const nowMs = entry.nowMs ?? Date.now();
  const ts = entry.makeTimestamp ? entry.makeTimestamp(nowMs) : ({ toMillis: () => nowMs } as unknown as Timestamp);

  await db.collection('adminAuditLog').add({
    action: entry.action.slice(0, 64),
    actorUid: entry.actor.uid.slice(0, 128),
    actorEmail: entry.actor.email.slice(0, 254),
    targetKeyHashPrefix: entry.targetKeyHashPrefix.slice(0, 16),
    details: entry.details.slice(0, 1000),
    createdAt: ts,
  });
}
