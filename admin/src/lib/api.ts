import { localLicenseStore } from './localLicenseStore';
import type { LicenseBilling, LicensePlan, LicenseStatus } from '../types/license';

export const adminApi = {
  getDashboardSummary: () => localLicenseStore.getDashboardSummary(),

  listLicenses: (params: {
    query?: string;
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
    cursor?: string | null;
    limit?: number;
  }) => localLicenseStore.listLicenses(params),

  getLicense: (keyHash: string) => localLicenseStore.getLicense(keyHash),

  createLicense: (params: {
    plan: LicensePlan;
    billing: LicenseBilling;
    expiresAt?: string | null;
    maxDevices?: number;
    buyerContact?: string;
    notes?: string;
  }) => localLicenseStore.createLicense(params),

  extendLicense: (params: { keyHash: string; newExpiresAt?: string | null; addDays?: number }) =>
    localLicenseStore.extendLicense(params),

  changePlan: (params: { keyHash: string; plan: LicensePlan; maxDevices?: number }) =>
    localLicenseStore.changePlan(params),

  revokeLicense: (params: { keyHash: string; reason: string }) =>
    localLicenseStore.revokeLicense(params),

  reinstateLicense: (keyHash: string) => localLicenseStore.reinstateLicense(keyHash),

  resetDevices: (keyHash: string) => localLicenseStore.resetDevices(keyHash),

  removeDevice: (params: { keyHash: string; deviceId: string }) =>
    localLicenseStore.removeDevice(params),

  reissueLicense: (params: { keyHash: string; reason?: string }) =>
    localLicenseStore.reissueLicense(params),

  exportLicensesCsv: (params: { status?: LicenseStatus | 'all'; plan?: LicensePlan | 'all' }) =>
    localLicenseStore.exportLicensesCsv(params),

  listAuditLogs: (params: { action?: string; cursor?: string | null; limit?: number }) =>
    localLicenseStore.listAuditLogs(params),
};
