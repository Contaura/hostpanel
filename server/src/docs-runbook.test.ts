import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runbookPath = resolve(process.cwd(), '..', 'docs/12-operations-runbook.md');
const launchChecklistPath = resolve(process.cwd(), '..', 'docs/13-launch-checklist.md');
const dq = String.fromCharCode(34);

const healthCurl = (endpoint: 'readiness' | 'live') =>
  'curl -sf -H "Authorization: Bearer ***" http://localhost:3001/api/health/' + endpoint;
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

    expect(checklist).toContain(healthCurl('readiness'));
    expect(checklist).not.toMatch(malformedLocalHealthHeader);
  });
});
