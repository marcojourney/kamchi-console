import type { LicenseBilling, LicensePlan } from '../types/license';

const PLAN_LABELS_EN: Record<LicensePlan, string> = {
  free: 'Free',
  pro: 'Pro',
  business: 'Business',
};

const PLAN_LABELS_KM: Record<LicensePlan, string> = {
  free: 'ឥតគិតថ្លៃ (Free)',
  pro: 'Pro',
  business: 'Business',
};

const BILLING_LABELS_EN: Record<LicenseBilling, string> = {
  monthly: 'Monthly',
  yearly: 'Yearly',
  lifetime: 'Lifetime',
};

const BILLING_LABELS_KM: Record<LicenseBilling, string> = {
  monthly: 'ប្រចាំខែ',
  yearly: 'ប្រចាំឆ្នាំ',
  lifetime: 'ប្រើប្រាស់អស់មួយជីវិត',
};

function formatDateEn(iso: string | null): string {
  if (!iso) return 'Lifetime (No expiration)';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Phnom_Penh',
  });
}

function formatDateKm(iso: string | null): string {
  if (!iso) return 'ប្រើប្រាស់អស់មួយជីវិត (គ្មានថ្ងៃផុតកំណត់)';
  const d = new Date(iso);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function buildTelegramMessages(params: {
  plan: LicensePlan;
  billing: LicenseBilling;
  plainKey: string;
  expiresAtIso: string | null;
  maxDevices: number;
}): { en: string; km: string } {
  const { plan, billing, plainKey, expiresAtIso, maxDevices } = params;

  const en = [
    `KamChi License Activated`,
    ``,
    `Plan: ${PLAN_LABELS_EN[plan]} (${BILLING_LABELS_EN[billing]})`,
    `License Key: ${plainKey}`,
    `Expires: ${formatDateEn(expiresAtIso)}`,
    `Devices Allowed: ${maxDevices}`,
    ``,
    `How to activate:`,
    `1. Open the KamChi app on your phone.`,
    `2. Go to Settings -> License / Upgrade.`,
    `3. Paste your License Key above and tap Activate.`,
    ``,
    `Please save this key safely—it cannot be retrieved again.`,
  ].join('\n');

  const km = [
    `លេខកូដអាជ្ញាប័ណ្ណ KamChi (កម្ចី)`,
    ``,
    `គម្រោង៖ ${PLAN_LABELS_KM[plan]} (${BILLING_LABELS_KM[billing]})`,
    `លេខកូដ៖ ${plainKey}`,
    `ផុតកំណត់៖ ${formatDateKm(expiresAtIso)}`,
    `ចំនួនឧបករណ៍៖ ${maxDevices} គ្រឿង`,
    ``,
    `របៀបបើកដំណើរការ៖`,
    `១. បើកកម្មវិធី KamChi (កម្ចី) លើទូរស័ព្ទរបស់អ្នក។`,
    `២. ចូលទៅកាន់ ការកំណត់ (Settings) -> អាជ្ញាប័ណ្ណ (License)។`,
    `៣. បិទភ្ជាប់លេខកូដខាងលើ រួចចុច Activate។`,
    ``,
    `សូមរក្សាទុកលេខកូដនេះឱ្យបានល្អ ព្រោះមិនអាចទាញយកម្តងទៀតបានទេ។`,
  ].join('\n');

  return { en, km };
}
