# KamChi (កម្ចី) License Admin Tool

Internal operations console for issuing, extending, revoking, reissuing, and backing up license keys for **KamChi (កម្ចី)**.

## Storage Mode (Local Browser Storage)

The Admin UI (`/admin` and the root preview app) now runs **100% locally in your browser** using `localStorage` and the Web Crypto API (`HMAC-SHA256` + `crypto.getRandomValues`):

- **Zero Firebase login or Cloud Functions required** to start creating and managing keys.
- **Plain keys are still shown only once** after creation or reissue—only the `HMAC-SHA256(normalizedKey, pepper)` hash is stored in `localStorage`.
- **Automatic expiry check**: overdue active licenses are automatically marked `expired` when loaded.
- **Backup & Restore**: Use the **Backup** tab to export/import a JSON snapshot (so you can move data between desktop and phone or keep a safe offline backup) and to set your matching KamChi `HMAC-SHA256` pepper.

---

## Deploying `/admin` to Vercel (Zero Env Vars Required)

1. Push this repository to GitHub/GitLab/Bitbucket.
2. Import into Vercel with:
   - **Root Directory**: `admin`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Deploy—no Firebase environment variables or Authorized Domains setup needed.

---

## Safe Daily Workflow (ABA / KHQR -> License -> Telegram)

1. Confirm the customer's **ABA Pay** or **KHQR** payment and note the reference ID.
2. Open the KamChi Admin Console on desktop or phone and go to **Create**.
3. Pick **Plan** (`Pro` = 2 devices, `Business` = 5 devices) and **Duration Preset** (`1 Month`, `1 Year`, or `Lifetime`).
4. Enter **Buyer Contact** (Telegram `@handle` or phone) and **Notes** (e.g. `ABA Ref #123456`).
5. Click **Generate License Key**, then tap **Copy Telegram (KM)** or **Copy Telegram (EN)** and send it to the customer.
6. Periodically open **Backup → Export JSON Backup** to save a copy of your local license database.

---

## Optional: Firebase Cloud Functions Backend (`/functions`)

The original Firebase Cloud Functions backend (`/functions`), `firestore.rules`, and `scripts/setAdminClaim.ts` remain in this repository if you ever decide to move storage back to a shared Firebase Blaze project later.
