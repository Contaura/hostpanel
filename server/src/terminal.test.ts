import { describe, expect, it } from 'vitest';
import { sanitizeTerminalEnv, selectTerminalShell } from './terminal';

describe('terminal hardening helpers', () => {
  it('strips exact and pattern-matched secrets from the pty environment', () => {
    const env = sanitizeTerminalEnv({
      PATH: '/usr/bin',
      JWT_SECRET: 'jwt',
      ADMIN_PASS_HASH: 'hash',
      SOME_API_TOKEN: 'token',
      SERVICE_PRIVATE_KEY: 'key',
      NORMAL_SETTING: 'ok',
    });

    expect(env).toEqual({ PATH: '/usr/bin', NORMAL_SETTING: 'ok' });
  });

  it('only allows known local shells and falls back to bash for unsafe values', () => {
    expect(selectTerminalShell('/bin/bash')).toBe('/bin/bash');
    expect(selectTerminalShell('/bin/bash -c id')).toBe('/bin/bash');
    expect(selectTerminalShell('/tmp/evil')).toBe('/bin/bash');
  });
});
