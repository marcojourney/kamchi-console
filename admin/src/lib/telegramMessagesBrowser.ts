import type { BindingMode, LicenseBilling, LicensePlan } from '../types/license';

const PLAN_LABELS_EN: Record<LicensePlan, string> = {
  pro: 'Pro',
  business: 'Business',
};

const PLAN_LABELS_KM: Record<LicensePlan, string> = {
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
    timeZone: 'UTC',
  });
}

function formatDateKm(iso: string | null): string {
  if (!iso) return 'ប្រើប្រាស់អស់មួយជីវិត (គ្មានថ្ងៃផុតកំណត់)';
  return iso.slice(0, 10);
}

export function buildTelegramMessages(params: {
  plan: LicensePlan;
  billing: LicenseBilling;
  plainKey: string;
  keyIdHex: string;
  expiresAtIso: string | null;
  maxDevices: number;
  bindingMode: BindingMode;
  deviceCode: string | null;
}): { en: string; km: string } {
  const { plan, billing, plainKey, keyIdHex, expiresAtIso, maxDevices, bindingMode, deviceCode } =
    params;

  const bindingEn =
    bindingMode === 'bound' && deviceCode ? `Device Code: ${deviceCode}` : 'Binding: Unbound (any device)';
  const bindingKm =
    bindingMode === 'bound' && deviceCode
      ? `កូដឧបករណ៍៖ ${deviceCode}`
      : 'ការភ្ជាប់ឧបករណ៍៖ ប្រើបានគ្រប់ឧបករណ៍';

  const en = [
    `KamChi License Key`,
    ``,
    `Plan: ${PLAN_LABELS_EN[plan]} (${BILLING_LABELS_EN[billing]})`,
    `Key ID: ${keyIdHex}`,
    `Expires: ${formatDateEn(expiresAtIso)}`,
    `Devices Allowed: ${maxDevices}`,
    bindingEn,
    ``,
    `License Key:`,
    plainKey,
    ``,
    `How to activate in KamChi:`,
    `1. Open the KamChi app on your phone.`,
    `2. Go to Settings -> License / Upgrade.`,
    `3. Paste the License Key above (or scan the QR code) and tap Activate.`,
  ].join('\n');

  const km = [
    `លេខកូដអាជ្ញាប័ណ្ណ KamChi (កម្ចី)`,
    ``,
    `គម្រោង៖ ${PLAN_LABELS_KM[plan]} (${BILLING_LABELS_KM[billing]})`,
    `លេខសម្គាល់ (Key ID)៖ ${keyIdHex}`,
    `ផុតកំណត់៖ ${formatDateKm(expiresAtIso)}`,
    `ចំនួនឧបករណ៍៖ ${maxDevices} គ្រឿង`,
    bindingKm,
    ``,
    `លេខកូដអាជ្ញាប័ណ្ណ៖`,
    plainKey,
    ``,
    `របៀបបើកដំណើរការក្នុង KamChi៖`,
    `១. បើកកម្មវិធី KamChi (កម្ចី) លើទូរស័ព្ទរបស់អ្នក។`,
    `២. ចូលទៅកាន់ ការកំណត់ (Settings) -> អាជ្ញាប័ណ្ណ (License)។`,
    `៣. បិទភ្ជាប់លេខកូដខាងលើ (ឬស្កេន QR Code) រួចចុច Activate។`,
  ].join('\n');

  return { en, km };
}
