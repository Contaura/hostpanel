import { describe, expect, it } from 'vitest';
import { assertHttpTargetAllowed } from './safe-target';

describe('assertHttpTargetAllowed', () => {
  it('rejects loopback IPv4 targets', async () => {
    await expect(assertHttpTargetAllowed('http://127.0.0.1:3001/api/settings')).rejects.toThrow(/blocked address range/i);
  });

  it('rejects bracketed IPv6 loopback literals', async () => {
    await expect(assertHttpTargetAllowed('http://[::1]:3001/api/settings')).rejects.toThrow(/blocked address range/i);
  });

  it('rejects bracketed IPv6 unique-local literals', async () => {
    await expect(assertHttpTargetAllowed('http://[fc00::1]/hook')).rejects.toThrow(/blocked address range/i);
  });

  it('rejects IPv4-mapped IPv6 literals', async () => {
    await expect(assertHttpTargetAllowed('http://[::ffff:127.0.0.1]/hook')).rejects.toThrow(/blocked address range/i);
  });
});
