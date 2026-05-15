import db from '../db';

export function getPasswordPolicy() {
  const rows = db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('pw_min_length','pw_require_upper','pw_require_number','pw_require_special')"
  ).all() as { key: string; value: string }[];
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return {
    min_length:      parseInt(m.pw_min_length) || 8,
    require_upper:   m.pw_require_upper   === '1',
    require_number:  m.pw_require_number  === '1',
    require_special: m.pw_require_special === '1',
  };
}

export function validatePassword(password: string): string | null {
  const p = getPasswordPolicy();
  if (password.length < p.min_length)                     return `Password must be at least ${p.min_length} characters`;
  if (p.require_upper   && !/[A-Z]/.test(password))       return 'Password must contain an uppercase letter';
  if (p.require_number  && !/[0-9]/.test(password))       return 'Password must contain a number';
  if (p.require_special && !/[^a-zA-Z0-9]/.test(password)) return 'Password must contain a special character';
  return null;
}
