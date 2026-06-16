import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runFileMock = vi.fn(async () => ({ stdout: '', stderr: '' }));
vi.mock('./process-runner', () => ({ runFile: runFileMock }));

describe('registerDkimKey', () => {
  let tmp = '';

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-opendkim-'));
    process.env.OPENDKIM_KEY_TABLE = path.join(tmp, 'KeyTable');
    process.env.OPENDKIM_SIGNING_TABLE = path.join(tmp, 'SigningTable');
    process.env.OPENDKIM_KEY_DIR = path.join(tmp, 'keys');
    await fs.mkdir(path.join(process.env.OPENDKIM_KEY_DIR, 'example.com'), { recursive: true });
    await fs.writeFile(path.join(process.env.OPENDKIM_KEY_DIR, 'example.com', 'default.private'), 'private-key');
    await fs.writeFile(process.env.OPENDKIM_KEY_TABLE, 'default._domainkey.example.com old:default:/old/key\nother._domainkey.other.test other.test:other:/key\n');
    await fs.writeFile(process.env.OPENDKIM_SIGNING_TABLE, '*@example.com default._domainkey.example.com\n*@other.test other._domainkey.other.test\n');
    runFileMock.mockClear();
    vi.resetModules();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.OPENDKIM_KEY_TABLE;
    delete process.env.OPENDKIM_SIGNING_TABLE;
    delete process.env.OPENDKIM_KEY_DIR;
  });

  it('updates OpenDKIM tables and reloads via argv-based commands without shell interpolation', async () => {
    const { registerDkimKey } = await import('./opendkim');

    await registerDkimKey('example.com', 'default');

    const privKey = path.join(tmp, 'keys', 'example.com', 'default.private');
    await expect(fs.readFile(process.env.OPENDKIM_KEY_TABLE!, 'utf8')).resolves.toBe([
      'other._domainkey.other.test other.test:other:/key',
      `default._domainkey.example.com example.com:default:${privKey}`,
      '',
    ].join('\n'));
    await expect(fs.readFile(process.env.OPENDKIM_SIGNING_TABLE!, 'utf8')).resolves.toBe([
      '*@other.test other._domainkey.other.test',
      '*@example.com default._domainkey.example.com',
      '',
    ].join('\n'));
    expect(runFileMock).toHaveBeenCalledWith('chown', ['opendkim:opendkim', privKey]);
    expect(runFileMock).toHaveBeenCalledWith('chmod', ['600', privKey]);
    expect(runFileMock).toHaveBeenCalledWith('systemctl', ['reload', 'opendkim'], { timeout: 120000 });
  });
});
