import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { AuthRequest } from '../middleware/auth';
import { runFile } from '../utils/process-runner';

const router = Router();

const WEBROOT = process.env.WEBROOT || '/var/www';

const SCRIPTS: Record<string, { name: string; description: string; category: string; url: string }> = {
  wordpress: {
    name: 'WordPress',
    description: 'The world\'s most popular CMS',
    category: 'CMS',
    url: 'https://wordpress.org/latest.tar.gz',
  },
  joomla: {
    name: 'Joomla',
    description: 'Flexible open-source CMS',
    category: 'CMS',
    url: 'https://downloads.joomla.org/cms/joomla5/5-2-6/Joomla_5-2-6-Stable-Full_Package.tar.gz',
  },
  drupal: {
    name: 'Drupal',
    description: 'Enterprise-grade open-source CMS',
    category: 'CMS',
    url: 'https://www.drupal.org/download-latest/tar.gz',
  },
  phpmyadmin: {
    name: 'phpMyAdmin',
    description: 'Web-based MySQL administration',
    category: 'Tools',
    url: 'https://www.phpmyadmin.net/downloads/phpMyAdmin-latest-all-languages.tar.gz',
  },
  prestashop: {
    name: 'PrestaShop',
    description: 'Feature-rich open-source e-commerce platform',
    category: 'E-Commerce',
    url: 'https://github.com/PrestaShop/PrestaShop/releases/download/8.1.7/prestashop_8.1.7.zip',
  },
  opencart: {
    name: 'OpenCart',
    description: 'Simple and powerful online store solution',
    category: 'E-Commerce',
    url: 'https://github.com/opencart/opencart/releases/download/4.0.2.3/opencart-4.0.2.3.zip',
  },
  woocommerce: {
    name: 'WooCommerce (via WordPress)',
    description: 'WordPress e-commerce plugin — installs WordPress first',
    category: 'E-Commerce',
    url: 'https://wordpress.org/latest.tar.gz',
  },
  laravel: {
    name: 'Laravel',
    description: 'Elegant PHP web application framework',
    category: 'Framework',
    url: 'composer',
  },
  symfony: {
    name: 'Symfony',
    description: 'High-performance PHP framework',
    category: 'Framework',
    url: 'composer',
  },
  codeigniter: {
    name: 'CodeIgniter 4',
    description: 'Lightweight PHP framework for rapid development',
    category: 'Framework',
    url: 'https://github.com/CodeIgniter/CodeIgniter4/releases/download/v4.5.1/CodeIgniter4-4.5.1.zip',
  },
  roundcube: {
    name: 'Roundcube',
    description: 'Browser-based IMAP email client',
    category: 'Email',
    url: 'https://github.com/roundcube/roundcubemail/releases/download/1.6.7/roundcubemail-1.6.7-complete.tar.gz',
  },
  nextcloud: {
    name: 'Nextcloud',
    description: 'Self-hosted file sharing and collaboration',
    category: 'Cloud',
    url: 'https://download.nextcloud.com/server/releases/latest.tar.bz2',
  },
  matomo: {
    name: 'Matomo Analytics',
    description: 'Open-source web analytics platform',
    category: 'Analytics',
    url: 'https://builds.matomo.org/matomo-latest.tar.gz',
  },
};

router.get('/available', (_req: AuthRequest, res: Response) => {
  const list = Object.entries(SCRIPTS).map(([id, meta]) => ({ id, ...meta }));
  res.json(list);
});

async function downloadToFile(url: string, dest: string): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok || !resp.body) throw new Error(`Download failed for ${url}: HTTP ${resp.status}`);
  await pipeline(Readable.fromWeb(resp.body as any), createWriteStream(dest));
}

router.post('/install', async (req: AuthRequest, res: Response) => {
  const { script, domain, dbName, dbUser, dbPass, siteTitle, adminUser, adminPass, adminEmail } = req.body;

  if (!script || !SCRIPTS[script]) {
    res.status(400).json({ error: 'Unknown script' });
    return;
  }
  if (!domain) {
    res.status(400).json({ error: 'Domain is required' });
    return;
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$/.test(domain)) {
    res.status(400).json({ error: 'Invalid domain' });
    return;
  }
  // WordPress without DB creds extracts the codebase but never writes
  // wp-config.php, leaving a half-installed site that the WP Manager can't
  // do anything with. Require the DB fields up front so "install succeeded"
  // implies a working wp-config.php.
  if (script === 'wordpress' && (!dbName || !dbUser || !dbPass)) {
    res.status(400).json({ error: 'WordPress install requires dbName, dbUser, and dbPass — these go into wp-config.php' });
    return;
  }

  const installPath = path.join(WEBROOT, domain, 'public_html');
  const meta = SCRIPTS[script];

  try {
    await fs.mkdir(installPath, { recursive: true });

    if (meta.url === 'composer') {
      const pkg = script === 'laravel' ? 'laravel/laravel' : `symfony/skeleton`;
      await runFile('composer', ['create-project', pkg, installPath, '--no-interaction'], { timeout: 300000 });
    } else {
      const isZip = meta.url.endsWith('.zip');
      const isBz2 = meta.url.endsWith('.bz2');
      const tmpFile = `/tmp/${script}-latest.${isZip ? 'zip' : isBz2 ? 'tar.bz2' : 'tar.gz'}`;
      const extractDir = `/tmp/${script}-extract`;
      // Native fetch instead of shelling out to curl
      await downloadToFile(meta.url, tmpFile);
      await fs.mkdir(extractDir, { recursive: true });
      if (isZip) {
        await runFile('unzip', ['-q', tmpFile, '-d', extractDir]);
      } else if (isBz2) {
        try {
          await runFile('tar', ['-xjf', tmpFile, '-C', extractDir, '--strip-components=1']);
        } catch {
          await runFile('tar', ['-xjf', tmpFile, '-C', extractDir]);
        }
      } else {
        try {
          await runFile('tar', ['-xzf', tmpFile, '-C', extractDir, '--strip-components=1']);
        } catch {
          await runFile('tar', ['-xzf', tmpFile, '-C', extractDir]);
        }
      }
      // Handle nested directory from zip
      const extracted = await fs.readdir(extractDir);
      const src = extracted.length === 1 ? path.join(extractDir, extracted[0]) : extractDir;
      await runFile('cp', ['-r', `${src}/.`, `${installPath}/`]);
      await fs.rm(extractDir, { recursive: true, force: true });
      await fs.rm(tmpFile, { force: true });
    }

    if (script === 'wordpress' && dbName && dbUser && dbPass) {
      // Configure WordPress
      const sampleConfig = path.join(installPath, 'wp-config-sample.php');
      const config = path.join(installPath, 'wp-config.php');
      let wpConfig = await fs.readFile(sampleConfig, 'utf-8');
      wpConfig = wpConfig
        .replace("database_name_here", dbName)
        .replace("username_here", dbUser)
        .replace("password_here", dbPass)
        .replace("localhost", process.env.DB_HOST || 'localhost');

      // Fetch salts via native fetch — no shell, no curl
      try {
        const saltsResp = await fetch('https://api.wordpress.org/secret-key/1.1/salt/');
        if (saltsResp.ok) {
          const salts = await saltsResp.text();
          wpConfig = wpConfig.replace(
            /\/\*\*#@\+\*\/[\s\S]*?\/\*\*#@-\*\//,
            salts
          );
        }
      } catch {}

      await fs.writeFile(config, wpConfig);

      // Run WP-CLI install if available. Use argv form so the user-supplied
      // site title, admin user/pass/email can't escape via quotes.
      try {
        const siteUrl = `http://${domain}`;
        await runFile('wp', [
          `--path=${installPath}`,
          'core', 'install',
          `--url=${siteUrl}`,
          `--title=${siteTitle || 'My Site'}`,
          `--admin_user=${adminUser || 'admin'}`,
          `--admin_password=${adminPass || 'changeme'}`,
          `--admin_email=${adminEmail || 'admin@example.com'}`,
          '--skip-email',
        ]).catch(() => {});
      } catch {}
    }

    // chown — try apache first, then www-data; ignore failures
    try { await runFile('chown', ['-R', 'apache:apache', installPath]); }
    catch {
      try { await runFile('chown', ['-R', 'www-data:www-data', installPath]); } catch {}
    }
    // chmod 755 on dirs, 644 on files — use find with -exec ... + (argv only)
    try { await runFile('find', [installPath, '-type', 'd', '-exec', 'chmod', '755', '{}', '+']); } catch {}
    try { await runFile('find', [installPath, '-type', 'f', '-exec', 'chmod', '644', '{}', '+']); } catch {}

    res.json({ message: `${meta.name} installed at ${installPath}`, url: `http://${domain}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
