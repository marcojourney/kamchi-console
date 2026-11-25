import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { onCall, type CallableRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  changePlanHandler,
  createLicenseHandler,
  expireOverdueLicensesHandler,
  exportLicensesCsvHandler,
  extendLicenseHandler,
  getDashboardSummaryHandler,
  getLicenseHandler,
  listAuditLogsHandler,
  listLicensesHandler,
  reissueLicenseHandler,
  reinstateLicenseHandler,
  removeDeviceHandler,
  resetDevicesHandler,
  revokeLicenseHandler,
  type HandlerContext,
} from './lib/adminHandlers.js';

const app = getApps().length ? getApps()[0] : initializeApp();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const db = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);

// Secret managed via: firebase functions:secrets:set LICENSE_PEPPER
const LICENSE_PEPPER = defineSecret('LICENSE_PEPPER');

const REGION = 'asia-southeast1';
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK !== 'false';

const CALLABLE_OPTIONS = {
  region: REGION,
  enforceAppCheck: ENFORCE_APP_CHECK,
  secrets: [LICENSE_PEPPER],
};

function buildContext(request: CallableRequest<unknown>): HandlerContext {
  return {
    db,
    pepper: LICENSE_PEPPER.value(),
    auth: request.auth
      ? {
          uid: request.auth.uid,
          token: request.auth.token as Record<string, unknown>,
        }
      : null,
    makeTimestamp: (ms: number) => Timestamp.fromMillis(ms),
  };
}

export const createLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return createLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const listLicenses = onCall(CALLABLE_OPTIONS, async (request) => {
  return listLicensesHandler(buildContext(request), (request.data ?? {}) as never);
});

export const getLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return getLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const getDashboardSummary = onCall(CALLABLE_OPTIONS, async (request) => {
  return getDashboardSummaryHandler(buildContext(request));
});

export const extendLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return extendLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const changePlan = onCall(CALLABLE_OPTIONS, async (request) => {
  return changePlanHandler(buildContext(request), (request.data ?? {}) as never);
});

export const revokeLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return revokeLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const reinstateLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return reinstateLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const resetDevices = onCall(CALLABLE_OPTIONS, async (request) => {
  return resetDevicesHandler(buildContext(request), (request.data ?? {}) as never);
});

export const removeDevice = onCall(CALLABLE_OPTIONS, async (request) => {
  return removeDeviceHandler(buildContext(request), (request.data ?? {}) as never);
});

export const reissueLicense = onCall(CALLABLE_OPTIONS, async (request) => {
  return reissueLicenseHandler(buildContext(request), (request.data ?? {}) as never);
});

export const exportLicensesCsv = onCall(CALLABLE_OPTIONS, async (request) => {
  return exportLicensesCsvHandler(buildContext(request), (request.data ?? {}) as never);
});

export const listAuditLogs = onCall(CALLABLE_OPTIONS, async (request) => {
  return listAuditLogsHandler(buildContext(request), (request.data ?? {}) as never);
});

export const expireOverdueLicenses = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: REGION,
    timeZone: 'Asia/Phnom_Penh',
  },
  async () => {
    await expireOverdueLicensesHandler({
      db,
      makeTimestamp: (ms: number) => Timestamp.fromMillis(ms),
    });
  }
);
