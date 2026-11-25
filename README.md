# KamChi (កម្ចី) License Admin Tool

Internal operations console and Firebase Cloud Functions backend for issuing, extending, revoking, reissuing, and auditing license keys for the **KamChi (កម្ចី)** mobile app on the same Firebase project.

---

## Architecture & License Contract

- **Firestore document path**: `licenses/{keyHash}`
  - Fields: `plan` (`free` | `pro` | `business`), `billing` (`monthly` | `yearly` | `lifetime`), `status` (`active` | `revoked` | `expired`), `issuedAt`, `expiresAt` (`Timestamp | null`), `maxDevices`, `buyerContact`, `notes`, `devices` (`[{ deviceId, label, activatedAt, lastSeenAt }]`).
- **Hashing**: `keyHash = HMAC-SHA256(normalizedKey, LICENSE_PEPPER)`. Plain keys are **never** stored in Firestore or audit logs.
- **Key format**: `KAMCHI-PRO-XXXX-XXXX-XXXX` / `KAMCHI-BIZ-XXXX-XXXX-XXXX` using an unambiguous 31-character alphabet (no `0`, `O`, `1`, `I`, `L`) with a trailing checksum character.
  - **Important**: When copying into your existing KamChi mobile app repository, keep your canonical `/functions/src/lib/licenseKey.ts` so generation, normalization, checksum, and hashing match the mobile app 100%.
- **Default `maxDevices`**: `pro = 2`, `business = 5`, `free = 1`.
- **Zero Direct Client Access**: `firestore.rules` denies all client reads and writes on `licenses`, `adminAuditLog`, and `adminRateLimits`. All admin operations go through callable Cloud Functions using the Firebase Admin SDK.
- **Security Controls**:
  - Google Sign-In (`Firebase Auth`) + server-side `request.auth.token.admin === true` and `email_verified === true` enforcement on every callable function.
  - Firebase App Check enforcement (`enforceAppCheck: true`) on callable functions.
  - Per-admin rate limiting (`adminRateLimits/{uid}_*`).
  - Immutable `adminAuditLog` collection written only by Cloud Functions.
  - Zero loan data is ever stored in this tool.

---

## Required Configuration (What You Must Fill In)

Before deploying to your KamChi mobile app's Firebase project, fill in the following values:

1. **Firebase Project ID**:
   - `.firebaserc`: replace `YOUR_KAMCHI_FIREBASE_PROJECT_ID` with your mobile app's Firebase project ID.
   - `admin/.env.production` (copied from `admin/.env.example`): fill in your Firebase Web App config (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, etc.) and `VITE_RECAPTCHA_SITE_KEY` for App Check.
2. **Allowed Admin Emails**:
   - `scripts/setAdminClaim.ts` (or `ADMIN_EMAILS` env var): replace `owner@example.com,trusted-admin@example.com` with your and your trusted admins' Google email addresses.
3. **Shared `LICENSE_PEPPER` Secret**:
   - Must be identical to the `LICENSE_PEPPER` secret used by the KamChi mobile app's activation function.

---

## 1. Set the `admin=true` Custom Claim

1. Make sure the owner and each trusted admin has signed into the Firebase project at least once (or create their user in Firebase Console -> Authentication).
2. Download a temporary service account key JSON (never commit it to git), or authenticate with `gcloud auth application-default login`.
3. Grant or revoke admin access:

```bash
# Grant admin claim to one operator
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
FIREBASE_PROJECT_ID=YOUR_KAMCHI_FIREBASE_PROJECT_ID \
npx tsx scripts/setAdminClaim.ts --email owner@example.com --grant

# Sync all emails in ADMIN_EMAILS
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
FIREBASE_PROJECT_ID=YOUR_KAMCHI_FIREBASE_PROJECT_ID \
ADMIN_EMAILS="owner@example.com,admin2@example.com" \
npx tsx scripts/setAdminClaim.ts --sync-allowlist

# Revoke access immediately (removes claim + revokes refresh tokens)
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
FIREBASE_PROJECT_ID=YOUR_KAMCHI_FIREBASE_PROJECT_ID \
npx tsx scripts/setAdminClaim.ts --email former@example.com --revoke
```

4. After granting, the user must **sign out and sign back in** so their ID token refreshes with `admin: true`.

---

## 2. Deploy Cloud Functions & Security Rules

```bash
# 1. Select your KamChi Firebase project
firebase use YOUR_KAMCHI_FIREBASE_PROJECT_ID

# 2. Set the shared LICENSE_PEPPER secret (must match the mobile app!)
firebase functions:secrets:set LICENSE_PEPPER

# 3. Run unit tests
cd functions
npm install
npm test
npm run build
cd ..

# 4. Deploy Firestore rules and Cloud Functions
firebase deploy --only firestore:rules,functions
```

---

## 3. Deploy the Admin UI to a Separate Hosting Site

1. Create a dedicated Hosting site in your Firebase project (e.g. `admin-<project>` or custom domain `admin.kamchi.app`):

```bash
firebase hosting:sites:create admin-YOUR_KAMCHI_FIREBASE_PROJECT_ID
firebase target:apply hosting admin admin-YOUR_KAMCHI_FIREBASE_PROJECT_ID
```

2. Create `admin/.env.production` from `admin/.env.example` with your Firebase Web SDK keys and App Check reCAPTCHA v3 site key (`VITE_RECAPTCHA_SITE_KEY`). Register the App Check site key in **Firebase Console -> App Check -> Apps**.
3. Build and deploy:

```bash
cd admin
npm install
npm run build
cd ..
firebase deploy --only hosting:admin
```

---

## 4. Safe Daily Workflow (ABA / KHQR -> License -> Telegram)

1. **Confirm Payment**: Verify the incoming **ABA Pay** or **KHQR** transfer in your bank app and note the transaction reference ID.
2. **Sign In**: Open `https://admin.<your-project>.web.app` on desktop or mobile and sign in with your Google admin account.
3. **Create License**:
   - Open **Create**, pick the paid **Plan** (`Pro` = 2 devices, `Business` = 5 devices) and **Duration Preset** (`1 Month`, `1 Year`, or `Lifetime`).
   - Enter the customer's **Buyer Contact** (Telegram `@handle` or phone number) and **Notes** (e.g. `ABA Ref #123456 - $15`).
   - Click **Generate License Key**.
4. **Send Once via Telegram**:
   - On the **Shown only once** screen, tap **Copy Telegram (KM)** (or **EN**), paste into Telegram, and send to the customer.
   - Never screenshot or store plain keys in shared spreadsheets; only the HMAC hash lives in Firestore.
5. **Customer Support**:
   - **Lost key**: Open the customer's license record and click **Reissue Key**. This revokes the old hash and creates a new one-time key with the same plan and expiration.
   - **New phone**: Open the license record and remove the old device or click **Reset All Devices**.
   - **Refund / abuse**: Click **Revoke** and enter the reason for the audit log.
