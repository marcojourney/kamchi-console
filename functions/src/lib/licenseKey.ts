import crypto from 'node:crypto';

/**
 * NOTE FOR EXISTING KAMCHI REPO INTEGRATION:
 * Keep and reuse the canonical `/functions/src/lib/licenseKey.ts` from your
 * KamChi mobile app repository so generation, normalization, checksum, and
 * HMAC-SHA256 hashing stay 100% identical across mobile activation and admin issuance.
 */

export type LicensePlan = 'free' | 'pro' | 'business';
export type LicenseBilling = 'monthly' | 'yearly' | 'lifetime';
export type LicenseStatus = 'active' | 'revoked' | 'expired';

export const DEFAULT_MAX_DEVICES: Record<LicensePlan, number> = {
  free: 1,
  pro: 2,
  business: 5,
};

// Unambiguous Crockford-inspired alphabet (omits 0, O, 1, I, L)
export const LICENSE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

const PLAN_PREFIX_MAP: Record<LicensePlan, string> = {
  free: 'FREE',
  pro: 'PRO',
  business: 'BIZ',
};

const PREFIX_PLAN_MAP: Record<string, LicensePlan> = {
  FREE: 'free',
  PRO: 'pro',
  BIZ: 'business',
};

/**
 * Computes a deterministic check character from the unambiguous alphabet
 * over the plan code and the 11 payload characters.
 */
function computeChecksumChar(planCode: string, payload11: string): string {
  const input = `${planCode}${payload11}`;
  let acc = 0;
  for (let i = 0; i < input.length; i++) {
    acc = (acc * 31 + input.charCodeAt(i) * (i + 1)) % LICENSE_ALPHABET.length;
  }
  return LICENSE_ALPHABET[acc];
}

/**
 * Normalizes user-entered or formatted keys for consistent checksum and HMAC hashing.
 * Example: " kamchi - pro - abcd - efgh - jkm2 " -> "KAMCHI-PRO-ABCD-EFGH-JKM2"
 */
export function normalizeLicenseKey(rawKey: string): string {
  const cleaned = rawKey
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '')
    .replace(/-+/g, '');

  // Re-insert canonical dashes if the stripped string matches KAMCHI + plan + 12 chars
  const match = cleaned.match(/^KAMCHI(FREE|PRO|BIZ)([A-Z0-9]{12})$/);
  if (!match) {
    return rawKey.trim().toUpperCase().replace(/\s+/g, '');
  }

  const [, planCode, body] = match;
  return `KAMCHI-${planCode}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

/**
 * Generates a new plain KamChi license key with embedded checksum.
 * Format: KAMCHI-PRO-XXXX-XXXX-XXXX | KAMCHI-BIZ-XXXX-XXXX-XXXX | KAMCHI-FREE-XXXX-XXXX-XXXX
 */
export function generateLicenseKey(plan: LicensePlan): string {
  const planCode = PLAN_PREFIX_MAP[plan];
  const randomBytes = crypto.randomBytes(11);
  let payload11 = '';
  for (let i = 0; i < 11; i++) {
    payload11 += LICENSE_ALPHABET[randomBytes[i] % LICENSE_ALPHABET.length];
  }
  const checkChar = computeChecksumChar(planCode, payload11);
  const fullBody = `${payload11}${checkChar}`;

  return `KAMCHI-${planCode}-${fullBody.slice(0, 4)}-${fullBody.slice(4, 8)}-${fullBody.slice(8, 12)}`;
}

/**
 * Validates format, alphabet membership, and checksum of a plain KamChi license key.
 */
export function validateLicenseKeyChecksum(rawKey: string): {
  valid: boolean;
  normalized: string;
  plan?: LicensePlan;
} {
  const normalized = normalizeLicenseKey(rawKey);
  const match = normalized.match(/^KAMCHI-(FREE|PRO|BIZ)-([A-Z0-9]{4})-([A-Z0-9]{4})-([A-Z0-9]{4})$/);
  if (!match) {
    return { valid: false, normalized };
  }

  const [, planCode, g1, g2, g3] = match;
  const body = `${g1}${g2}${g3}`;
  for (const ch of body) {
    if (!LICENSE_ALPHABET.includes(ch)) {
      return { valid: false, normalized };
    }
  }

  const payload11 = body.slice(0, 11);
  const providedCheck = body.slice(11, 12);
  const expectedCheck = computeChecksumChar(planCode, payload11);

  if (providedCheck !== expectedCheck) {
    return { valid: false, normalized };
  }

  return {
    valid: true,
    normalized,
    plan: PREFIX_PLAN_MAP[planCode],
  };
}

/**
 * Computes the Firestore document ID: HMAC-SHA256(normalizedKey, LICENSE_PEPPER).
 * Plain keys are never stored.
 */
export function hashLicenseKey(rawKey: string, pepper: string): string {
  if (!pepper || pepper.length < 16) {
    throw new Error('LICENSE_PEPPER is missing or too short (minimum 16 characters).');
  }
  const normalized = normalizeLicenseKey(rawKey);
  return crypto.createHmac('sha256', pepper).update(normalized, 'utf8').digest('hex');
}

/**
 * Returns a non-sensitive 12-character hex prefix for logs and search display.
 */
export function getKeyHashPrefix(keyHash: string): string {
  return keyHash.slice(0, 12);
}
