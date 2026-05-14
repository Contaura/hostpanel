import { Router, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { AuthRequest } from '../middleware/auth';

const router = Router();
const execAsync = promisify(exec);

const WEBROOT = process.env.WEBROOT || '/var/www';

const SCRIPTS: Record<string, { name: string; description: string; url: string }> = {
  wordpress: {
    name: 'WordPress',
    description: 'The world\'s most popular CMS',
    url: 'https://wordpress.org/latest.tar.gz',
  },
  joomla: {
    name: 'Joomla',
    description: 'Flexible open-source CMS',
    url: 'https://downloads.joomla.org/cms/joomla5/5-2-6/Joomla_5-2-6-Stable-Full_Package.tar.gz',
  },
  drupal: {
    name: 'Drupal',
    description: 'Enterprise-grade open-source CMS',
    url: 'https://www.drupal.org/download-latest/tar.gz',
  },
  phpmyadmin: {
    name: 'phpMyAdmin',
    description: 'Web-based MySQL administration',
    url: 'https://www.phpmyadmin.net/downloads/phpMyAdmin-latest-all-languages.tar.gz',
  },
};

router.get('/available', (_req: AuthRequest, res: Response) => {
  const list = Object.entries(SCRIPTS).map(([id, meta]) => ({ id, ...meta }));
  res.json(list);
});

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

  const installPath = path.join(WEBROOT, domain, 'public_html');
  const meta = SCRIPTS[script];

  try {
    await fs.mkdir(installPath, { recursive: true });

    // Download and extract
    const tarFile = `/tmp/${script}-latest.tar.gz`;
    await execAsync(`curl -L -o ${tarFile} '${meta.url}' 2>&1`, { timeout: 120000 });
    await execAsync(`tar -xzf ${tarFile} -C /tmp/${script}-extract --strip-components=1 2>/dev/null || (mkdir -p /tmp/${script}-extract && tar -xzf ${tarFile} -C /tmp/${script}-extract)`);
    await execAsync(`cp -r /tmp/${script}-extract/. ${installPath}/`);
    await execAsync(`rm -rf /tmp/${script}-extract ${tarFile}`);

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

      // Fetch salts
      try {
        const { stdout: salts } = await execAsync(`curl -s https://api.wordpress.org/secret-key/1.1/salt/`);
        wpConfig = wpConfig.replace(
          /\/\*\*#@\+\*\/[\s\S]*?\/\*\*#@-\*\//,
          salts
        );
      } catch {}

      await fs.writeFile(config, wpConfig);

      // Run WP-CLI install if available
      try {
        const siteUrl = `http://${domain}`;
        await execAsync(
          `wp --path=${installPath} core install --url='${siteUrl}' --title='${(siteTitle || 'My Site').replace(/'/g, "'\\''")}' --admin_user='${adminUser || 'admin'}' --admin_password='${(adminPass || 'changeme').replace(/'/g, "'\\''")}' --admin_email='${adminEmail || 'admin@example.com'}' --skip-email 2>/dev/null || true`
        );
      } catch {}
    }

    await execAsync(`chown -R apache:apache ${installPath} 2>/dev/null || chown -R www-data:www-data ${installPath} 2>/dev/null || true`);
    await execAsync(`find ${installPath} -type d -exec chmod 755 {} \\; && find ${installPath} -type f -exec chmod 644 {} \\;`);

    res.json({ message: `${meta.name} installed at ${installPath}`, url: `http://${domain}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
