import fs from 'fs/promises';
import path from 'path';

export function isPathInsideBase(targetPath: string, basePath: string): boolean {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(base + path.sep);
}

export function resolveInsideBase(userPath: string, baseDir: string): string {
  // Reject undefined / empty up front so callers get a clear 400 instead of a
  // TypeError when body/query fields are missing.
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new Error('Path is required');
  }

  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, userPath.replace(/^\/+/, ''));

  // Anchor the prefix check on a path separator so /var/wwwx doesn't pass /var/www.
  if (!isPathInsideBase(resolved, base)) {
    throw new Error('Path traversal not allowed');
  }

  // File-manager archive/chmod code still shells out for some operations, so
  // keep rejecting shell metacharacters until every route uses argv-based spawn.
  if (/[$`"\\!]/.test(resolved)) {
    throw new Error('Path contains invalid characters');
  }

  return resolved;
}

async function realPathIfExists(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}

export async function assertSafeFileTarget(resolvedPath: string, baseDir: string): Promise<void> {
  const realBase = await fs.realpath(baseDir).catch(() => path.resolve(baseDir));

  // Existing files/directories must resolve inside the real base. This blocks a
  // file inside /var/www that is actually a symlink to /etc/passwd or another
  // sensitive location.
  const realTarget = await realPathIfExists(resolvedPath);
  if (realTarget) {
    if (!isPathInsideBase(realTarget, realBase)) {
      throw new Error('Resolved path points outside base directory');
    }
    return;
  }

  // New files do not have a realpath yet. Resolve the nearest existing parent;
  // if that parent is a symlink escaping the base, writing the new file would
  // escape too.
  let parent = path.dirname(resolvedPath);
  while (true) {
    const realParent = await realPathIfExists(parent);
    if (realParent) {
      if (!isPathInsideBase(realParent, realBase)) {
        throw new Error('Resolved parent points outside base directory');
      }
      return;
    }

    const next = path.dirname(parent);
    if (next === parent) {
      throw new Error('No existing parent directory found');
    }
    parent = next;
  }
}
