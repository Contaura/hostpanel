import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runbookPath = resolve(process.cwd(), '..', 'docs/12-operations-runbook.md');
const launchChecklistPath = resolve(process.cwd(), '..', 'docs/13-launch-checklist.md');
const comparisonPath = resolve(process.cwd(), '..', 'docs/cpanel-comparison.md');
const sq = String.fromCharCode(39);
const authHeader = ['Authorization: Bearer', 'AUTH_TOKEN'].join(' ');
const healthCurl = (endpoint: 'readiness' | 'live') =>
  ['curl -sf -H ', sq, authHeader, sq, ' http://localhost:3001/api/health/', endpoint].join('');
const malformedLocalHealthHeader = /Bearer (?:\*\*\*|TOKEN|AUTH_TOKEN)\s+http:\/\/localhost:3001\/api\/health\//;

describe('operations runbook command examples', () => {
  it('documents authenticated health curls with closed Authorization headers', () => {
    const runbook = readFileSync(runbookPath, 'utf8');

    expect(runbook).toContain(healthCurl('readiness'));
    expect(runbook).toContain(healthCurl('live'));
    expect(runbook).not.toMatch(malformedLocalHealthHeader);
  });
});

describe('production launch checklist', () => {
  it('requires readiness verification and names owners for every manual launch blocker', () => {
    const checklist = readFileSync(launchChecklistPath, 'utf8');

    expect(checklist).toContain(healthCurl('readiness'));
    expect(checklist).toMatch(/\| Manual blocker \| Owner \| Launch-day evidence required \|/);
    expect(checklist).toMatch(/\| External uptime monitor \| Marcos \|/);
    expect(checklist).toMatch(/\| Automated nightly database backup \| Ron \+ Marcos \|/);
    expect(checklist).toMatch(/\| Off-server backup replication \| Marcos \|/);
    expect(checklist).toMatch(/\| Notification webhook channel \| Marcos \|/);
    expect(checklist).toMatch(/\| Admin account TOTP \| Marcos \|/);
    expect(checklist).toMatch(/\| Payment webhook secrets \| Marcos \|/);
  });

  it('documents a syntactically valid authenticated readiness curl in the launch-day sequence', () => {
    const checklist = readFileSync(launchChecklistPath, 'utf8');
    const readinessCurl = checklist.split('\n').find(line => line.trim().startsWith('curl ') && line.includes('/api/health/readiness')) || '';

    expect(checklist).toContain(healthCurl('readiness'));
    expect(readinessCurl.split(sq).length - 1).toBe(2);
    expect(checklist).not.toMatch(malformedLocalHealthHeader);
  });

  it('does not list completed phpMyAdmin live validation as remaining cPanel parity work', () => {
    const comparison = readFileSync(comparisonPath, 'utf8');

    expect(comparison).toContain('phpMyAdmin launch/Signon handoff');
    expect(comparison).not.toMatch(/Signon still needs live validation/i);
    expect(comparison).not.toMatch(/^1\. Validate phpMyAdmin Signon end-to-end/m);
  });
});
