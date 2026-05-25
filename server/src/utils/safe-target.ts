import dns from 'dns/promises';
import { isIP } from 'net';
import { URL } from 'url';

function normalizeHostForIpChecks(host: string): string {
  // URL.hostname keeps brackets around IPv6 literals in current Node.js
  // releases. net.isIP('[::1]') returns 0, so strip URL brackets before
  // checking private/loopback IPv6 ranges. Strip zone IDs as a conservative
  // normalization step for scoped IPv6 literals as well.
  return host.toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/%.+$/, '');
}

// Webhook URLs supplied by an admin become fetch-time SSRF primitives — they
// let the panel make outbound HTTP requests to whatever address the URL
// resolves to, and the response body comes back into delivery logs. Blocking
// private/loopback/link-local destinations stops the obvious abuse paths
// (AWS/GCP IMDS, internal services, the panel's own API).
function isBlockedHostLiteral(host: string): boolean {
  const h = normalizeHostForIpChecks(host);
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v = isIP(h);
  if (v === 4) {
    const [a, b] = h.split('.').map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
    if (a >= 224) return true; // multicast / reserved
  } else if (v === 6) {
    if (
      h === '::1' ||
      h === '::' ||
      h.startsWith('::ffff:') ||
      h.startsWith('fc') ||
      h.startsWith('fd') ||
      h.startsWith('fe80') ||
      h.startsWith('ff')
    ) return true;
  }
  return false;
}

export async function assertHttpTargetAllowed(rawUrl: string): Promise<URL> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw new Error('Invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('Only http and https URLs are allowed');
  if (isBlockedHostLiteral(u.hostname)) throw new Error('Webhook target is in a blocked address range');
  if (isIP(normalizeHostForIpChecks(u.hostname)) === 0) {
    // Hostname — resolve and re-check every address. Catches the DNS-rebind
    // shape where the hostname looks public but resolves to a private IP.
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
    for (const a of addrs) {
      if (isBlockedHostLiteral(a.address)) throw new Error('Webhook target resolves to a blocked address');
    }
  }
  return u;
}
