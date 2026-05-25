import { mkdtemp, mkdir, symlink, writeFile, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertSafeFileTarget, resolveInsideBase } from './file-path';

let tempRoot = '';
let base = '';
let outside = '';

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'hostpanel-file-path-'));
  base = path.join(tempRoot, 'base');
  outside = path.join(tempRoot, 'outside');
  await mkdir(base);
  await mkdir(outside);
});

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
});

describe('resolveInsideBase', () => {
  it('rejects path traversal outside the configured base directory', () => {
    expect(() => resolveInsideBase('../outside/secret.txt', base)).toThrow(/path traversal/i);
  });

  it('allows normal relative paths under the configured base directory', () => {
    expect(resolveInsideBase('site/index.html', base)).toBe(path.join(base, 'site', 'index.html'));
  });
});

describe('assertSafeFileTarget', () => {
  it('rejects existing symlinks that resolve outside the base directory', async () => {
    await writeFile(path.join(outside, 'secret.txt'), 'secret');
    await symlink(path.join(outside, 'secret.txt'), path.join(base, 'linked-secret.txt'));

    const target = resolveInsideBase('linked-secret.txt', base);

    await expect(assertSafeFileTarget(target, base)).rejects.toThrow(/outside base/i);
  });

  it('rejects new files whose parent directory is a symlink outside the base directory', async () => {
    await symlink(outside, path.join(base, 'linked-dir'));

    const target = resolveInsideBase('linked-dir/new-file.txt', base);

    await expect(assertSafeFileTarget(target, base)).rejects.toThrow(/outside base/i);
  });

  it('allows new files under a real directory inside the base directory', async () => {
    await mkdir(path.join(base, 'site'));

    const target = resolveInsideBase('site/new-file.txt', base);

    await expect(assertSafeFileTarget(target, base)).resolves.toBeUndefined();
  });
});
