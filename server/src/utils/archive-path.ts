import path from 'path';

export function assertSafeArchiveEntryName(entryName: string): void {
  if (typeof entryName !== 'string' || entryName.length === 0 || entryName.includes('\0')) {
    throw new Error('Unsafe archive entry');
  }

  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error('Unsafe archive entry');
  }

  const clean = path.posix.normalize(normalized);
  if (clean === '.' || clean === '..' || clean.startsWith('../') || clean.includes('/../')) {
    throw new Error('Unsafe archive entry');
  }
}

export function assertSafeArchiveEntryListing(listing: string): void {
  for (const line of listing.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry) continue;
    assertSafeArchiveEntryName(entry);
  }
}

export function assertArchiveListingHasNoLinks(verboseListing: string): void {
  for (const line of verboseListing.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    // GNU tar and zipinfo both use the first mode/type character to identify
    // symlinks (`l`) and hard links (`h` in tar listings). Reject both because
    // extraction runs as root and could otherwise plant links inside webroots.
    const type = trimmed[0];
    if (type === 'l' || type === 'h') {
      throw new Error('Archive contains link entries, which are not allowed');
    }
  }
}
