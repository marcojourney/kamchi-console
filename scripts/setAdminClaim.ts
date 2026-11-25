/**
 * scripts/setAdminClaim.ts
 *
 * Grants or revokes the Firebase Auth custom claim `{ admin: true }` for trusted
 * KamChi License Admin operators.
 *
 * Usage:
 *   # Option 1: Pass a single email via CLI flags
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/setAdminClaim.ts --email owner@example.com --grant
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/setAdminClaim.ts --email former-admin@example.com --revoke
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/setAdminClaim.ts --email owner@example.com --inspect
 *
 *   # Option 2: Grant to all emails listed in ALLOWED_ADMIN_EMAILS below (or ADMIN_EMAILS env var)
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/setAdminClaim.ts --sync-allowlist
 */

import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// =============================================================================
// [FILL IN] Your KamChi mobile app Firebase Project ID & allowed admin emails
// =============================================================================
const FIREBASE_PROJECT_ID = 'kamchi-9de5e';//process.env.FIREBASE_PROJECT_ID || 'YOUR_KAMCHI_FIREBASE_PROJECT_ID';
const ALLOWED_ADMIN_EMAILS: string[] = (
  process.env.ADMIN_EMAILS || 'owner@example.com,trusted-admin@example.com'
)
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function parseArgs(argv: string[]) {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args.set(key, next);
        i++;
      } else {
        args.set(key, true);
      }
    }
  }
  return args;
}

async function main() {
  if (FIREBASE_PROJECT_ID === 'YOUR_KAMCHI_FIREBASE_PROJECT_ID' && !process.env.GOOGLE_CLOUD_PROJECT) {
    console.warn(
      'Warning: FIREBASE_PROJECT_ID is still set to YOUR_KAMCHI_FIREBASE_PROJECT_ID. Set FIREBASE_PROJECT_ID env var or edit scripts/setAdminClaim.ts.'
    );
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      ...(FIREBASE_PROJECT_ID !== 'YOUR_KAMCHI_FIREBASE_PROJECT_ID'
        ? { projectId: FIREBASE_PROJECT_ID }
        : {}),
    });
  }

  const auth = getAuth();
  const args = parseArgs(process.argv.slice(2));

  const syncAllowlist = Boolean(args.get('sync-allowlist'));
  const emailArg = typeof args.get('email') === 'string' ? (args.get('email') as string).trim() : '';
  const shouldRevoke = Boolean(args.get('revoke'));
  const shouldInspect = Boolean(args.get('inspect'));

  const targets = syncAllowlist ? ALLOWED_ADMIN_EMAILS : emailArg ? [emailArg] : [];
  if (targets.length === 0) {
    console.error(
      'Usage:\n' +
        '  npx tsx scripts/setAdminClaim.ts --email <user@gmail.com> [--grant | --revoke | --inspect]\n' +
        '  npx tsx scripts/setAdminClaim.ts --sync-allowlist'
    );
    process.exit(1);
  }

  for (const email of targets) {
    const user = await auth.getUserByEmail(email);
    const existingClaims = user.customClaims ?? {};

    if (shouldInspect) {
      console.log(`User ${user.email} (${user.uid}) claims:`, existingClaims);
      continue;
    }

    if (shouldRevoke) {
      const nextClaims = { ...existingClaims };
      delete nextClaims.admin;
      await auth.setCustomUserClaims(user.uid, nextClaims);
      // Revoke refresh tokens so the removed admin loses access immediately
      await auth.revokeRefreshTokens(user.uid);
      console.log(`Revoked admin claim and refresh tokens for ${user.email} (${user.uid}).`);
    } else {
      await auth.setCustomUserClaims(user.uid, { ...existingClaims, admin: true });
      console.log(
        `Granted { admin: true } to ${user.email} (${user.uid}). Ask them to sign out and sign back in to refresh their ID token.`
      );
    }
  }
}

main().catch((err) => {
  console.error('Failed to update admin claim:', err);
  process.exit(1);
});
