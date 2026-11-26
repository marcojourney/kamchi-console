import type { LicensePlan } from '../types/license';

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

function computeChecksumChar(planCode: string, payload11: string): string {
  const input = `${planCode}${payload11}`;
  let acc = 0;
  for (let i = 0; i < input.length; i++) {
    acc = (acc * 31 + input.charCodeAt(i) * (i + 1)) % LICENSE_ALPHABET.length;
  }
  return LICENSE_ALPHABET[acc];
}

export function normalizeLicenseKey(rawKey: string): string {
  const cleaned = rawKey
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, '')
    .replace(/-+/g, '');

  const match = cleaned.match(/^KAMCHI(FREE|PRO|BIZ)([A-Z0-9]{12})$/);
  if (!match) {
    return rawKey.trim().toUpperCase().replace(/\s+/g, '');
  }

  const [, planCode, body] = match;
  return `KAMCHI-${planCode}-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
}

export function generateLicenseKey(plan: LicensePlan): string {
  const planCode = PLAN_PREFIX_MAP[plan];
  const randomBytes = new Uint8Array(11);
  crypto.getRandomValues(randomBytes);

  let payload11 = '';
  for (let i = 0; i < 11; i++) {
    payload11 += LICENSE_ALPHABET[randomBytes[i] % LICENSE_ALPHABET.length];
  }
  const checkChar = computeChecksumChar(planCode, payload11);
  const fullBody = `${payload11}${checkChar}`;

  return `KAMCHI-${planCode}-${fullBody.slice(0, 4)}-${fullBody.slice(4, 8)}-${fullBody.slice(8, 12)}`;
}

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

export async function hashLicenseKeyBrowser(rawKey: string, pepper: string): Promise<string> {
  if (!pepper || pepper.length < 16) {
    throw new Error('Local pepper must be at least 16 characters.');
  }
  const encoder = new TextEncoder();
  const normalized = normalizeLicenseKey(rawKey);
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(normalized));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function generateRandomPepper(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getKeyHashPrefix(keyHash: string): string {
  return keyHash.slice(0, 12);
}
