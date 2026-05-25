import { describe, expect, it, vi } from 'vitest';
import { buildArchiveCommand, runFile } from './process-runner';

describe('process-runner', () => {
  it('builds archive commands as executable plus argv instead of shell strings', () => {
    expect(buildArchiveCommand('zip', '/tmp/out archive.zip', ['/var/www/site one', '/var/www/file"two'])).toEqual({
      command: 'zip',
      args: ['-r', '/tmp/out archive.zip', '/var/www/site one', '/var/www/file"two'],
    });

    expect(buildArchiveCommand('tar.gz', '/tmp/out archive.tar.gz', ['/var/www/site one'])).toEqual({
      command: 'tar',
      args: ['-czf', '/tmp/out archive.tar.gz', '/var/www/site one'],
    });
  });

  it('rejects unsupported archive formats before process launch', () => {
    expect(() => buildArchiveCommand('rar', '/tmp/out.rar', ['/var/www/site'])).toThrow('Unsupported archive format');
  });

  it('runs execFile with shell disabled', async () => {
    const execFile = vi.fn((_cmd, _args, _opts, cb) => cb(null, { stdout: 'ok', stderr: '' }));
    await expect(runFile('printf', ['ok'], { execFile })).resolves.toEqual({ stdout: 'ok', stderr: '' });
    expect(execFile).toHaveBeenCalledWith(
      'printf',
      ['ok'],
      expect.objectContaining({ shell: false }),
      expect.any(Function),
    );
  });
});
