import { httpsCallable } from 'firebase/functions';
import { auth, functions } from './firebase';
import type {
  AuditLogEntry,
  CreateLicenseResponse,
  DashboardSummary,
  LicenseBilling,
  LicensePlan,
  LicenseRecord,
  LicenseStatus,
  ReissueLicenseResponse,
} from '../types/license';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore/Callable Error: ', JSON.stringify(errInfo));
  throw new Error(formatCallableErrorMessage(error));
}

export function formatCallableErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as { code?: string }).code ?? '');
    const msg = 'message' in error ? String((error as { message?: string }).message ?? '') : '';

    if (code.includes('not-found') && msg.toLowerCase().includes('function')) {
      return 'Cloud Functions are not deployed on this Firebase project yet. Deploy /functions first (see README).';
    }
    if (code.includes('permission-denied')) {
      return msg || 'Access denied. Ensure your Google account has the admin=true custom claim.';
    }
    if (code.includes('unauthenticated')) {
      return 'Your session expired. Sign in with Google again.';
    }
    if (code.includes('resource-exhausted')) {
      return msg || 'Rate limit reached. Wait a minute and try again.';
    }
    if (code.includes('internal') || code.includes('unavailable')) {
      return msg || 'Could not reach Cloud Functions. Verify deployment, region, and App Check settings.';
    }
    if (msg) return msg;
  }
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

async function callAdmin<Req, Res>(
  fnName: string,
  payload: Req,
  opType: OperationType,
  path: string
): Promise<Res> {
  try {
    const callable = httpsCallable<Req, Res>(functions, fnName);
    const result = await callable(payload);
    return result.data;
  } catch (error) {
    return handleFirestoreError(error, opType, path);
  }
}

export const adminApi = {
  getDashboardSummary: () =>
    callAdmin<Record<string, never>, DashboardSummary>(
      'getDashboardSummary',
      {},
      OperationType.LIST,
      'licenses'
    ),

  listLicenses: (params: {
    query?: string;
    status?: LicenseStatus | 'all';
    plan?: LicensePlan | 'all';
    cursor?: string | null;
    limit?: number;
  }) =>
    callAdmin<typeof params, { items: LicenseRecord[]; nextCursor: string | null }>(
      'listLicenses',
      params,
      OperationType.LIST,
      'licenses'
    ),

  getLicense: (keyHash: string) =>
    callAdmin<{ keyHash: string }, { license: LicenseRecord }>(
      'getLicense',
      { keyHash },
      OperationType.GET,
      `licenses/${keyHash}`
    ),

  createLicense: (params: {
    plan: LicensePlan;
    billing: LicenseBilling;
    expiresAt?: string | null;
    maxDevices?: number;
    buyerContact?: string;
    notes?: string;
  }) =>
    callAdmin<typeof params, CreateLicenseResponse>(
      'createLicense',
      params,
      OperationType.CREATE,
      'licenses'
    ),

  extendLicense: (params: { keyHash: string; newExpiresAt?: string | null; addDays?: number }) =>
    callAdmin<typeof params, { license: LicenseRecord }>(
      'extendLicense',
      params,
      OperationType.UPDATE,
      `licenses/${params.keyHash}`
    ),

  changePlan: (params: { keyHash: string; plan: LicensePlan; maxDevices?: number }) =>
    callAdmin<typeof params, { license: LicenseRecord }>(
      'changePlan',
      params,
      OperationType.UPDATE,
      `licenses/${params.keyHash}`
    ),

  revokeLicense: (params: { keyHash: string; reason: string }) =>
    callAdmin<typeof params, { license: LicenseRecord }>(
      'revokeLicense',
      params,
      OperationType.UPDATE,
      `licenses/${params.keyHash}`
    ),

  reinstateLicense: (keyHash: string) =>
    callAdmin<{ keyHash: string }, { license: LicenseRecord }>(
      'reinstateLicense',
      { keyHash },
      OperationType.UPDATE,
      `licenses/${keyHash}`
    ),

  resetDevices: (keyHash: string) =>
    callAdmin<{ keyHash: string }, { license: LicenseRecord }>(
      'resetDevices',
      { keyHash },
      OperationType.UPDATE,
      `licenses/${keyHash}`
    ),

  removeDevice: (params: { keyHash: string; deviceId: string }) =>
    callAdmin<typeof params, { license: LicenseRecord }>(
      'removeDevice',
      params,
      OperationType.UPDATE,
      `licenses/${params.keyHash}`
    ),

  reissueLicense: (params: { keyHash: string; reason?: string }) =>
    callAdmin<typeof params, ReissueLicenseResponse>(
      'reissueLicense',
      params,
      OperationType.WRITE,
      `licenses/${params.keyHash}`
    ),

  exportLicensesCsv: (params: { status?: LicenseStatus | 'all'; plan?: LicensePlan | 'all' }) =>
    callAdmin<typeof params, { csv: string; count: number }>(
      'exportLicensesCsv',
      params,
      OperationType.LIST,
      'licenses'
    ),

  listAuditLogs: (params: { action?: string; cursor?: string | null; limit?: number }) =>
    callAdmin<typeof params, { items: AuditLogEntry[]; nextCursor: string | null }>(
      'listAuditLogs',
      params,
      OperationType.LIST,
      'adminAuditLog'
    ),
};
