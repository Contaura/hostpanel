import { describe, expect, it } from 'vitest';
import { assertSafeArchiveEntryName } from './archive-path';

describe('assertSafeArchiveEntryName', () => {
  it('allows ordinary relative archive entries', () => {
    expect(() => assertSafeArchiveEntryName('public_html/index.html')).not.toThrow();
  });

  it('rejects parent-directory traversal entries', () => {
    expect(() => assertSafeArchiveEntryName('../escape.txt')).toThrow(/unsafe archive entry/i);
    expect(() => assertSafeArchiveEntryName('public_html/../../escape.txt')).toThrow(/unsafe archive entry/i);
  });

  it('rejects absolute archive entries and Windows drive paths', () => {
    expect(() => assertSafeArchiveEntryName('/etc/passwd')).toThrow(/unsafe archive entry/i);
    expect(() => assertSafeArchiveEntryName('C:\\Windows\\win.ini')).toThrow(/unsafe archive entry/i);
  });

  it('rejects empty and NUL-containing entries', () => {
    expect(() => assertSafeArchiveEntryName('')).toThrow(/unsafe archive entry/i);
    expect(() => assertSafeArchiveEntryName('safe\0evil')).toThrow(/unsafe archive entry/i);
  });
});
