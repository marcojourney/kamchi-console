export type LicensePlan = 'pro' | 'business';
export type LicenseBilling = 'monthly' | 'yearly' | 'lifetime';
export type LicenseStatus = 'active' | 'revoked' | 'expired';
export type BindingMode = 'bound' | 'unbound';

export const DEFAULT_MAX_DEVICES: Record<LicensePlan, number> = {
  pro: 1,
  business: 1,
};

export interface OfflineSelfVerifyResult {
  valid: boolean;
  checksumValid: boolean;
  signatureValid: boolean;
  deviceCodeHashMatches: boolean;
  payloadVersion: number;
  error?: string;
}

export interface LicenseRecord {
  id: string;
  keyIdHex: string;
  maskedKey: string;
  plan: LicensePlan;
  billing: LicenseBilling;
  status: LicenseStatus;
  issuedAt: string;
  expiresAt: string | null;
  issuedAtDay: number;
  expiresAtDay: number;
  maxDevices: number;
  bindingMode: BindingMode;
  deviceCode: string | null;
  deviceCodeHashHex: string;
  publicKeyHex: string;
  buyerContact: string;
  notes: string;
  revokedReason: string | null;
  revokedAt: string | null;
  reissuedToKeyId: string | null;
  reissuedFromKeyId: string | null;
  updatedAt: string | null;
}

export interface CreateLicenseResponse {
  keyIdHex: string;
  plainKey: string;
  kamchiLicenseFileName: string;
  kamchiLicenseFileContent: string;
  selfVerify: OfflineSelfVerifyResult;
  license: LicenseRecord;
  telegramMessages: {
    en: string;
    km: string;
  };
}

export interface ReissueLicenseResponse extends CreateLicenseResponse {
  oldKeyIdHex: string;
  newKeyIdHex: string;
}

export interface DashboardSummary {
  total: number;
  byStatus: Record<LicenseStatus, number>;
  byPlan: Record<LicensePlan, number>;
  byBinding: Record<BindingMode, number>;
  expiringNext14Days: LicenseRecord[];
  recentLicenses: LicenseRecord[];
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actor: string;
  targetKeyIdHex: string;
  details: string;
  createdAt: string;
}
