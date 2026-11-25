import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('firestore.rules zero-client-access contract', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  it('uses rules_version 2 and global default-deny', () => {
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('explicitly locks down licenses, adminAuditLog, and adminRateLimits from client SDKs', () => {
    expect(rules).toContain('match /licenses/{keyHash}');
    expect(rules).toContain('match /adminAuditLog/{logId}');
    expect(rules).toContain('match /adminRateLimits/{uid}');
    expect(rules).not.toMatch(/allow\s+(read|write|get|list|create|update|delete)\s*:\s*if\s+true/);
    expect(rules).not.toMatch(/allow\s+(read|write|get|list|create|update|delete)\s*:\s*if\s+request\.auth/);
  });
});
