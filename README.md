# KamChi (កម្ចី) Offline License Key Generator (`kamchi-console`)

Browser-based issuing console for **KamChi (កម្ចី)** offline Ed25519 `KC1-` license keys, designed to verify 100% cleanly inside the KamChi PWA with zero backend servers required.

## Cryptographic Spec (`KC1-`)

- **Signing**: Ed25519 (`@noble/ed25519`) strictly over the raw **24-byte big-endian payload**
- **Checksum**: First 2 bytes of `SHA-256(payload || signature)` appended for an **90-byte** frame
- **Encoding**: Unpadded RFC 4648 Base32 (`144` characters) formatted as `KC1-XXXXX-XXXXX-...-XXXX`
- **Binding**: Either **Device-bound** (`SHA-256(normalizedDeviceCode)[0..8]`) or **Unbound** (8 zero bytes)
- **Delivery**: Copy raw `KC1-...` key, copy Khmer/English Telegram message, scan or download QR PNG, or export `<keyId>-<plan>.kamchi-license`

---

## First-Time Setup

1. Open **Signing Key Vault** (`Settings`) in the console.
2. Click **Generate Ed25519 Keypair** (or import an existing 64-char hex Ed25519 private key).
3. Store the 64-char hex **Private Key** safely in a password manager (it is never hardcoded in source code and is excluded from JSON backups).
4. Copy `LICENSE_PUBLIC_KEY_HEX` into KamChi's `src/config/license.ts`.

---

## Deploying `/admin` to Vercel (Zero Env Vars Required)

1. Push this repository to GitHub/GitLab/Bitbucket.
2. Import into Vercel with:
   - **Root Directory**: `admin`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Deploy—your signing key stays in your browser vault (never in server env vars or git).

---

## Local Development & Verification

```bash
# Run unit tests for binary payload layout, Ed25519 round-trip, and local store
npx vitest run admin/src/lib/offlineLicense.test.ts admin/src/lib/localLicenseStore.test.ts

# Typecheck & build
npm run lint
npm run build
```
