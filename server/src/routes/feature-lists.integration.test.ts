import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Missing listen address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('feature list parity foundation', () => {
  let tmp: string;
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-feature-lists-'));
    process.env.DATA_DIR = tmp;
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    vi.resetModules();
  });

  async function appForRoutes() {
    const route = (await import('./feature-lists')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/feature-lists', route);
    return listen(app);
  }

  it('returns a grouped cPanel/WHM parity feature catalog', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const res = await fetch(`${server.url}/api/feature-lists/catalog`);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.features.some((f: any) => f.key === 'webdav')).toBe(true);
    expect(body.features.some((f: any) => f.key === 'dns-clustering')).toBe(true);
    expect(body.groups.email).toContain('mail-trace');
  });

  it('creates and returns feature lists with enabled feature keys', async () => {
    const server = await appForRoutes(); closeServer = server.close;
    const create = await fetch(`${server.url}/api/feature-lists`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Starter', description: 'Starter package', features: ['email-accounts', 'mail-trace'] }),
    });
    expect(create.status).toBe(200);
    await expect(create.json()).resolves.toMatchObject({ name: 'Starter', features: ['email-accounts', 'mail-trace'] });
    const list = await fetch(`${server.url}/api/feature-lists`);
    const body: any = await list.json();
    expect(body[0].features).toContain('mail-trace');
  });

  it('enforces plan feature lists for client portal account routes', async () => {
    const mod = await import('./feature-lists');
    const db = (await import('../db')).default;
    const planId = Number(db.prepare("INSERT INTO plans (name) VALUES ('Starter')").run().lastInsertRowid);
    const clientId = Number(db.prepare("INSERT INTO clients (name,email,portal_enabled) VALUES ('Acme','owner@example.com',1)").run().lastInsertRowid);
    db.prepare("INSERT INTO accounts (username,domain,client_id,plan_id,status) VALUES ('acme','example.com',?,?, 'active')").run(clientId, planId);
    const listId = Number(db.prepare("INSERT INTO feature_lists (name, features) VALUES ('No Backups', ?)").run(JSON.stringify(['file-manager'])).lastInsertRowid);
    db.prepare('INSERT INTO plan_feature_lists (plan_id, feature_list_id) VALUES (?, ?)').run(planId, listId);

    const app = express();
    app.get('/portal/backups/:domain', (req, _res, next) => { (req as any).clientId = clientId; next(); }, mod.requireClientFeature('backup-wizard'), (_req, res) => res.json({ ok: true }));
    app.get('/portal/files/:domain/list', (req, _res, next) => { (req as any).clientId = clientId; next(); }, mod.requireClientFeature('file-manager'), (_req, res) => res.json({ ok: true }));
    const server = await listen(app); closeServer = server.close;

    expect((await fetch(`${server.url}/portal/backups/example.com`)).status).toBe(403);
    expect((await fetch(`${server.url}/portal/files/example.com/list`)).status).toBe(200);
  });

  it('enforces reseller privilege lists for reseller-role API tokens', async () => {
    const mod = await import('./feature-lists');
    const db = (await import('../db')).default;
    const adminId = Number(db.prepare("INSERT INTO admin_users (username,email,password_hash,role) VALUES ('reseller1','r@example.com','x','reseller')").run().lastInsertRowid);
    const resellerId = Number(db.prepare("INSERT INTO resellers (admin_user_id, company) VALUES (?, 'R Co')").run(adminId).lastInsertRowid);
    db.prepare('INSERT INTO reseller_privileges (reseller_id, features) VALUES (?, ?)').run(resellerId, JSON.stringify(['webdav']));

    const app = express();
    app.use((req, _res, next) => { (req as any).user = { username: 'reseller1', role: 'reseller' }; next(); });
    app.get('/webdav', mod.enforceResellerPrivilege('webdav'), (_req, res) => res.json({ ok: true }));
    app.get('/analytics', mod.enforceResellerPrivilege('analytics'), (_req, res) => res.json({ ok: true }));
    const server = await listen(app); closeServer = server.close;

    expect((await fetch(`${server.url}/webdav`)).status).toBe(200);
    expect((await fetch(`${server.url}/analytics`)).status).toBe(403);
  });
});
