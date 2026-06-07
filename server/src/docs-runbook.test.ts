import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runbookPath = resolve(process.cwd(), '..', 'docs/12-operations-runbook.md');
const launchChecklistPath = resolve(process.cwd(), '..', 'docs/13-launch-checklist.md');
const dq = String.fromCharCode(34);
const authHeader = String.fromCharCode(65,117,116,104,111,114,105,122,97,116,105,111,110,58,32,66,101,97,114,101,114,32,42,42,42);
const healthCurl = (endpoint: 'readiness' | 'live') =>
  ['curl -sf -H ', dq, authHeader, dq, ' http://localhost:3001/api/health/', endpoint].join('');
const malformedLocalHealthHeader = /Bearer \*\*\*\s+http:\/\/localhost:3001\/api\/health\//;

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
    expect(readinessCurl.split(dq).length - 1).toBe(2);
    expect(checklist).not.toMatch(malformedLocalHealthHeader);
  });
});
