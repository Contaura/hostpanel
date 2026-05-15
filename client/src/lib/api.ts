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
    window.location.href = '/login';
  }
  return res;
}
