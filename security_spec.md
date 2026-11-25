# Security Specification — KamChi License Admin

## 1. Data & Access Invariants

1. **Zero Direct Client Firestore Access**: All three collections (`licenses`, `adminAuditLog`, `adminRateLimits`) plus the catch-all rule MUST deny all direct client `read` and `write` operations (`allow read, write: if false;`), even for signed-in users or admins.
2. **Server-Side Admin Verification**: All operations on `licenses`, `adminAuditLog`, and `adminRateLimits` execute exclusively inside Firebase Cloud Functions using the Firebase Admin SDK, after verifying `request.auth != null`, `request.auth.token.email_verified === true`, and `request.auth.token.admin === true`.
3. **No Plain License Keys Persisted**: Only `HMAC-SHA256(normalizedKey, LICENSE_PEPPER)` is stored as the document ID in `licenses/{keyHash}`. Plain keys are returned once on `createLicense` / `reissueLicense` and never stored in `licenses` or `adminAuditLog`.
4. **No Loan Data**: Neither `licenses` nor `adminAuditLog` stores any KamChi loan/borrower ledger data.

## 2. The "Dirty Dozen" Adversarial Payloads (Client Firestore SDK)

Every payload below targeting direct Firestore client access MUST fail with `PERMISSION_DENIED`:

1. Unauthenticated `getDoc` on `/licenses/abc123...`
2. Unauthenticated `getDocs` (list) on `/licenses`
3. Authenticated non-admin `getDoc` on `/licenses/abc123...`
4. Authenticated admin (`admin: true` claim) `getDoc` on `/licenses/abc123...` (still denied — must go through callable functions)
5. Authenticated admin `setDoc` creating `/licenses/fakehash` with `plan: "business"`
6. Authenticated user `updateDoc` on `/licenses/abc123...` attempting to extend `expiresAt`
7. Authenticated user `deleteDoc` on `/licenses/abc123...`
8. Authenticated admin `addDoc` on `/adminAuditLog` attempting to forge an audit entry
9. Authenticated user `getDocs` on `/adminAuditLog` attempting to scrape admin activity
10. Authenticated admin `updateDoc` on `/adminAuditLog/log1` attempting to alter history
11. Authenticated user `setDoc` on `/adminRateLimits/uid1` attempting to reset their rate limit counter
12. Authenticated user `getDoc` on `/arbitraryCollection/doc1` testing the global catch-all deny rule

## 3. Verification

Run `firestore.rules.test.ts` (or ESLint with `@firebase/eslint-plugin-security-rules`) to verify zero permissive client rules and 100% enforcement of default-deny across all paths.
