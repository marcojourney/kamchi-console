import { localLicenseStore } from './localLicenseStore';
import type { BindingMode, LicenseBilling, LicensePlan, LicenseStatus } from '../types/license';

export const adminApi = {
  getSigningKeyStatus: () => localLicenseStore.getSigningKeyStatus(),

  importSigningKey: (privateKeyHex: string, persistInBrowser = true) =>
    localLicenseStore.importSigningKey(privateKeyHex, persistInBrowser),

  generateNewSigningKeypair: (persistInBrowser = true) =>
    localLicenseStore.generateNewSigningKeypair(persistInBrowser),

  clearSigningKey: () => localLicenseStore.clearSigningKey(),

  getDashboardSummary: () => localLicenseStore.getDashboardSummary(),

  listLicenses: (params: {
    query?: string;
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
    bindingMode?: BindingMode | 'all';
    cursor?: string | null;
    limit?: number;
  }) => localLicenseStore.listLicenses(params),

  getLicense: (keyIdHex: string) => localLicenseStore.getLicense(keyIdHex),

  createLicense: (params: {
    plan: LicensePlan;
    billing: LicenseBilling;
    durationDays?: number;
    customExpiresAtMs?: number | null;
    maxDevices?: number;
    bindingMode: BindingMode;
    deviceCode?: string;
    buyerContact?: string;
    notes?: string;
  }) => localLicenseStore.createLicense(params),

  renewLicense: (params: {
    keyIdHex: string;
    billing: LicenseBilling;
    durationDays?: number;
    customExpiresAtMs?: number | null;
  }) => localLicenseStore.renewLicense(params),

  reissueLicense: (params: {
    keyIdHex: string;
    plan?: LicensePlan;
    maxDevices?: number;
    bindingMode: BindingMode;
    deviceCode?: string;
    reason?: string;
  }) => localLicenseStore.reissueLicense(params),

  revokeLicense: (params: { keyIdHex: string; reason: string }) =>
    localLicenseStore.revokeLicense(params),

  reinstateLicense: (keyIdHex: string) => localLicenseStore.reinstateLicense(keyIdHex),

  updateBuyerMeta: (params: { keyIdHex: string; buyerContact: string; notes: string }) =>
    localLicenseStore.updateBuyerMeta(params),

  exportLicensesCsv: (params: { status?: LicenseStatus | 'all'; plan?: LicensePlan | 'all' }) =>
    localLicenseStore.exportLicensesCsv(params),

  listAuditLogs: (params: { action?: string; cursor?: string | null; limit?: number }) =>
    localLicenseStore.listAuditLogs(params),
};
