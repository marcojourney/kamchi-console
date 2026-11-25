"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expireOverdueLicenses = exports.listAuditLogs = exports.exportLicensesCsv = exports.reissueLicense = exports.removeDevice = exports.resetDevices = exports.reinstateLicense = exports.revokeLicense = exports.changePlan = exports.extendLicense = exports.getDashboardSummary = exports.getLicense = exports.listLicenses = exports.createLicense = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const params_1 = require("firebase-functions/params");
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const adminHandlers_js_1 = require("./lib/adminHandlers.js");
const app = (0, app_1.getApps)().length ? (0, app_1.getApps)()[0] : (0, app_1.initializeApp)();
const databaseId = process.env.FIRESTORE_DATABASE_ID?.trim();
const db = databaseId && databaseId !== '(default)' ? (0, firestore_1.getFirestore)(app, databaseId) : (0, firestore_1.getFirestore)(app);
// Secret managed via: firebase functions:secrets:set LICENSE_PEPPER
const LICENSE_PEPPER = (0, params_1.defineSecret)('LICENSE_PEPPER');
const REGION = 'asia-southeast1';
const ENFORCE_APP_CHECK = process.env.ENFORCE_APP_CHECK !== 'false';
const CALLABLE_OPTIONS = {
    region: REGION,
    // Let browser preflight requests reach the callable handler, including Vercel.
    invoker: 'public',
    cors: true,
    enforceAppCheck: ENFORCE_APP_CHECK,
    secrets: [LICENSE_PEPPER],
};
function buildContext(request) {
    return {
        db,
        pepper: LICENSE_PEPPER.value(),
        auth: request.auth
            ? {
                uid: request.auth.uid,
                token: request.auth.token,
            }
            : null,
        makeTimestamp: (ms) => firestore_1.Timestamp.fromMillis(ms),
    };
}
exports.createLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.createLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.listLicenses = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.listLicensesHandler)(buildContext(request), (request.data ?? {}));
});
exports.getLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.getLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.getDashboardSummary = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.getDashboardSummaryHandler)(buildContext(request));
});
exports.extendLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.extendLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.changePlan = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.changePlanHandler)(buildContext(request), (request.data ?? {}));
});
exports.revokeLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.revokeLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.reinstateLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.reinstateLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.resetDevices = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.resetDevicesHandler)(buildContext(request), (request.data ?? {}));
});
exports.removeDevice = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.removeDeviceHandler)(buildContext(request), (request.data ?? {}));
});
exports.reissueLicense = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.reissueLicenseHandler)(buildContext(request), (request.data ?? {}));
});
exports.exportLicensesCsv = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.exportLicensesCsvHandler)(buildContext(request), (request.data ?? {}));
});
exports.listAuditLogs = (0, https_1.onCall)(CALLABLE_OPTIONS, async (request) => {
    return (0, adminHandlers_js_1.listAuditLogsHandler)(buildContext(request), (request.data ?? {}));
});
exports.expireOverdueLicenses = (0, scheduler_1.onSchedule)({
    schedule: 'every 60 minutes',
    region: REGION,
    timeZone: 'Asia/Phnom_Penh',
}, async () => {
    await (0, adminHandlers_js_1.expireOverdueLicensesHandler)({
        db,
        makeTimestamp: (ms) => firestore_1.Timestamp.fromMillis(ms),
    });
});
//# sourceMappingURL=index.js.map