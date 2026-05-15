// Return the URL only if it uses an http(s) scheme. Anything else — including
// javascript:, data:, vbscript: — falls back to `null` so the caller can render
// a non-link or a placeholder.
//
// React does not strip dangerous schemes from <a href={...}> (it warned in
// dev for a while and stopped). We pull URLs out of the panel database
// (wp_options.siteurl, settings.webmail_url, etc.) which an admin or a
// compromised WordPress install could plant a javascript: URL in, so we
// gate every server-supplied href through this.
export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  // Relative URL — let it through, browsers can't run code from those.
  if (s.startsWith('/') && !s.startsWith('//')) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    return null;
  } catch {
    return null;
  }
}
