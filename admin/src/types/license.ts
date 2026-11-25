export type LicensePlan = 'free' | 'pro' | 'business';
export type LicenseBilling = 'monthly' | 'yearly' | 'lifetime';
export type LicenseStatus = 'active' | 'revoked' | 'expired';

export const DEFAULT_MAX_DEVICES: Record<LicensePlan, number> = {
  free: 1,
  pro: 2,
  business: 5,
};

export interface DeviceRecord {
  deviceId: string;
  label: string;
  activatedAt: string;
  lastSeenAt: string;
}

export interface LicenseRecord {
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

export interface CreateLicenseResponse {
  keyHash: string;
  keyHashPrefix: string;
  plainKey: string;
  license: LicenseRecord;
  telegramMessages: {
    en: string;
    km: string;
  };
}

export interface ReissueLicenseResponse extends CreateLicenseResponse {
  oldKeyHash: string;
  newKeyHash: string;
}

export interface DashboardSummary {
  total: number;
  byStatus: Record<LicenseStatus, number>;
  byPlan: Record<LicensePlan, number>;
  expiringNext14Days: LicenseRecord[];
  recentActivations: Array<{
    keyHash: string;
    keyHashPrefix: string;
    plan: LicensePlan;
    buyerContact: string;
    deviceId: string;
    label: string;
    activatedAt: string;
  }>;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorUid: string;
  actorEmail: string;
  targetKeyHashPrefix: string;
  details: string;
  createdAt: string;
}
