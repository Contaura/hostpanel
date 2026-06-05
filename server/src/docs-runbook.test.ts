import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const runbookPath = resolve(process.cwd(), '..', 'docs/12-operations-runbook.md');

describe('operations runbook command examples', () => {
  it('documents authenticated health curls with closed Authorization headers', () => {
    const runbook = readFileSync(runbookPath, 'utf8');

    expect(runbook).toMatch(/curl -sf -H "Authorization: Bearer [^"\n]+" http:\/\/localhost:3001\/api\/health\/readiness/);
    expect(runbook).toMatch(/curl -sf -H "Authorization: Bearer [^"\n]+" http:\/\/localhost:3001\/api\/health\/live/);
    expect(runbook).not.toMatch(/Bearer [^"\n]* http:\/\/localhost:3001\/api\/health\//);
  });
});
