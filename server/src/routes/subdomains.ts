import { Router, Response } from 'express';
import { runFile } from '../utils/process-runner';
import fs from 'fs/promises';
import path from 'path';
import { AuthRequest } from '../middleware/auth';

const router = Router();

const VHOST_DIR = process.env.VHOST_DIR || '/etc/httpd/conf.d';
const WEBROOT   = process.env.WEBROOT   || '/var/www';

function sanitizeSub(name: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(name);
}
function sanitizeDomain(domain: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9.-]{0,253}[a-zA-Z0-9]$/.test(domain);
}

router.get('/list', async (_req: AuthRequest, res: Response) => {
  try {
    const files = await fs.readdir(VHOST_DIR).catch(() => [] as string[]);
    const subdomains = files
      .filter(f => f.startsWith('sub_') && f.endsWith('.conf'))
      .map(f => {
        const full = f.replace('sub_', '').replace('.conf', '');
        const dotIdx = full.indexOf('.');
        return {
          subdomain: full.slice(0, dotIdx),
          domain: full.slice(dotIdx + 1),
          fqdn: full,
        };
      });
    res.json(subdomains);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/create', async (req: AuthRequest, res: Response) => {
  const { subdomain, domain, docRoot: customRoot } = req.body;
  if (!sanitizeSub(subdomain)) return res.status(400).json({ error: 'Invalid subdomain name' });
  if (!sanitizeDomain(domain)) return res.status(400).json({ error: 'Invalid domain name' });
  if (customRoot && (!/^\/[a-zA-Z0-9_./ -]+$/.test(customRoot) || /["$`\\!]/.test(customRoot))) {
    return res.status(400).json({ error: 'Invalid document root path' });
  }

  const fqdn = `${subdomain}.${domain}`;
  const docRoot = customRoot || path.join(WEBROOT, domain, subdomain, 'public_html');

  const vhostConf = `<VirtualHost *:80>
    ServerName ${fqdn}
    DocumentRoot ${docRoot}
    ErrorLog /var/log/httpd/${fqdn}-error.log
    CustomLog /var/log/httpd/${fqdn}-access.log combined

    <Directory ${docRoot}>
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
`;
  try {
    await fs.mkdir(docRoot, { recursive: true });
    await fs.writeFile(path.join(VHOST_DIR, `sub_${fqdn}.conf`), vhostConf);
    await fs.writeFile(
      path.join(docRoot, 'index.html'),
      `<html><body><h1>${fqdn}</h1><p>Hosted by HostPanel</p></body></html>`
    );
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ fqdn, docRoot });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:fqdn', async (req: AuthRequest, res: Response) => {
  const fqdn = req.params.fqdn;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]+$/.test(fqdn)) return res.status(400).json({ error: 'Invalid FQDN' });
  try {
    await fs.unlink(path.join(VHOST_DIR, `sub_${fqdn}.conf`)).catch(() => {});
    await runFile('systemctl', ['reload', 'httpd']).catch(() => ({ stdout: '', stderr: '' }));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
