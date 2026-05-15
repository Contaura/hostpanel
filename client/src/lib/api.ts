function token() { return localStorage.getItem('hp_token') || ''; }

export async function fetchApi(url: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...options.headers,
    },
  });
  if (res.status === 401 && !url.includes('/api/auth/') && !url.includes('/api/portal/')) {
    localStorage.removeItem('hp_token');
    localStorage.removeItem('hp_user');
    localStorage.removeItem('hp_role');
    window.location.href = '/login';
  }
  return res;
}

// Open an authenticated GET endpoint in a new tab. A plain <a href> won't
// attach the JWT (it lives in localStorage, not a cookie), so PDF / file /
// backup download links all 401'd. Fetch with the Authorization header,
// turn the body into an object URL, and open that. Optional `tokenKey`
// lets the client portal pass its own portal token instead of hp_token.
export async function openAuthenticatedDownload(
  url: string,
  opts: { tokenKey?: string; filename?: string } = {},
): Promise<void> {
  const tok = localStorage.getItem(opts.tokenKey || 'hp_token') || '';
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).error || msg; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const blob = await r.blob();
  const objUrl = URL.createObjectURL(blob);
  if (opts.filename) {
    // Force a download with a specific name (used for backup archives, file
    // manager downloads — the browser otherwise picks something based on the
    // Content-Disposition header which may or may not be set).
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = opts.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(objUrl, '_blank', 'noopener,noreferrer');
  }
  setTimeout(() => URL.revokeObjectURL(objUrl), 60_000);
}
