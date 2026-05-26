import express from 'express';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/process-runner', () => ({ runFile: vi.fn(async () => ({ stdout: '', stderr: '' })) }));

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('Missing address');
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => new Promise<void>((res, rej) => server.close(err => err ? rej(err) : res())) });
    });
  });
}

describe('client portal team subaccount authentication', () => {
  let tmp = '';
  let closeServer: (() => Promise<void>) | undefined;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hostpanel-team-portal-'));
    process.env.DATA_DIR = tmp;
    process.env.JWT_SECRET = 'test-team-secret';
    process.env.NAMED_DIR = tmp;
    process.env.WEBROOT = path.join(tmp, 'www');
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.JWT_SECRET;
    delete process.env.NAMED_DIR;
    delete process.env.WEBROOT;
    vi.resetModules();
  });

  async function appWithSeed(permissions: string[] = ['files']) {
    const db = (await import('../db')).default;
    await import('./team-users'); // creates the team_users table used by portal team login
    const portal = (await import('./client-portal')).default;
    const { auditMiddleware } = await import('./audit-log');
    const passwordHash = await bcrypt.hash('password123', 4);
    const clientId = Number(db.prepare("INSERT INTO clients (name,email,portal_enabled,password_hash) VALUES ('Acme','owner@example.com',1,?)").run(passwordHash).lastInsertRowid);
    const accountId = Number(db.prepare("INSERT INTO accounts (username,domain,client_id,status) VALUES ('acme','example.com',?,'active')").run(clientId).lastInsertRowid);
    const otherAccountId = Number(db.prepare("INSERT INTO accounts (username,domain,client_id,status) VALUES ('other','other.com',?,'active')").run(clientId).lastInsertRowid);
    db.prepare("INSERT INTO invoices (invoice_number,client_id,account_id,amount,due_date) VALUES ('INV-1',?,?,25,'2027-01-01')").run(clientId, accountId);
    db.prepare("INSERT INTO invoices (invoice_number,client_id,account_id,amount,due_date) VALUES ('INV-2',?,?,50,'2027-01-01')").run(clientId, otherAccountId);
    const teamHash = await bcrypt.hash('team-password', 4);
    db.prepare('INSERT INTO team_users (client_id,account_id,username,email,password_hash,permissions,status) VALUES (?,?,?,?,?,?,\'active\')')
      .run(clientId, accountId, 'helper', 'helper@example.com', teamHash, JSON.stringify(permissions));
    await fs.writeFile(path.join(tmp, 'example.com.zone'), '; test zone\n');
    await fs.mkdir(path.join(process.env.WEBROOT!, 'example.com', 'public_html'), { recursive: true });
    await fs.mkdir(path.join(process.env.WEBROOT!, 'other.com', 'public_html'), { recursive: true });
    await fs.writeFile(path.join(process.env.WEBROOT!, 'example.com', 'public_html', 'index.html'), 'own site');
    await fs.writeFile(path.join(process.env.WEBROOT!, 'other.com', 'public_html', 'index.html'), 'other site');
    const app = express(); app.use(express.json()); app.use('/api', auditMiddleware); app.use('/api/portal', portal);
    return listen(app);
  }

  it('lets an active team subaccount log into the client portal and exposes its permission scope', async () => {
    const server = await appWithSeed(['files']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    expect(login.status).toBe(200);
    const body = await login.json();
    expect(body.team_user.permissions).toEqual(['files']);
    const me = await fetch(`${server.url}/api/portal/me`, { headers: { authorization: `Bearer ${body.token}` } });
    expect(me.status).toBe(200);
    expect((await me.json()).team_user.permissions).toEqual(['files']);
  });

  it('blocks team subaccounts from portal routes outside their assigned permissions', async () => {
    const server = await appWithSeed(['files']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();
    const invoices = await fetch(`${server.url}/api/portal/invoices`, { headers: { authorization: `Bearer ${token}` } });
    expect(invoices.status).toBe(403);
    expect((await invoices.json()).error).toContain('billing');
  });

  it('allows team subaccounts when the required permission is present', async () => {
    const server = await appWithSeed(['billing']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();
    const invoices = await fetch(`${server.url}/api/portal/invoices`, { headers: { authorization: `Bearer ${token}` } });
    expect(invoices.status).toBe(200);
    expect(await invoices.json()).toHaveLength(1);
  });

  it('narrows billing views for team subaccounts to their assigned hosting account', async () => {
    const server = await appWithSeed(['billing']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();

    const invoices = await fetch(`${server.url}/api/portal/invoices`, { headers: { authorization: `Bearer ${token}` } });
    expect(invoices.status).toBe(200);
    const rows = await invoices.json();
    expect(rows.map((row: any) => row.invoice_number)).toEqual(['INV-1']);

    const forbidden = await fetch(`${server.url}/api/portal/invoices/2`, { headers: { authorization: `Bearer ${token}` } });
    expect(forbidden.status).toBe(404);
  });

  it('blocks team subaccounts from domains outside their assigned hosting account', async () => {
    const server = await appWithSeed(['dns']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();

    const ownDomain = await fetch(`${server.url}/api/portal/domains/example.com/dns`, { headers: { authorization: `Bearer ${token}` } });
    expect(ownDomain.status).toBe(200);

    const otherDomain = await fetch(`${server.url}/api/portal/domains/other.com/dns`, { headers: { authorization: `Bearer ${token}` } });
    expect(otherDomain.status).toBe(403);
  });

  it('narrows account, file, and database namespaces to the assigned hosting account', async () => {
    const server = await appWithSeed(['files', 'databases']); closeServer = server.close;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();

    const accounts = await fetch(`${server.url}/api/portal/accounts`, { headers: { authorization: `Bearer ${token}` } });
    expect(accounts.status).toBe(200);
    expect((await accounts.json()).map((row: any) => row.domain)).toEqual(['example.com']);

    const ownFiles = await fetch(`${server.url}/api/portal/files/example.com/list`, { headers: { authorization: `Bearer ${token}` } });
    expect(ownFiles.status).toBe(200);
    const otherFiles = await fetch(`${server.url}/api/portal/files/other.com/list`, { headers: { authorization: `Bearer ${token}` } });
    expect(otherFiles.status).toBe(403);

    const allowedDb = await fetch(`${server.url}/api/portal/databases`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'acme_blog' }) });
    expect([200, 500]).toContain(allowedDb.status); // 500 is acceptable in test env without MySQL after namespace authorization passes.
    const blockedDb = await fetch(`${server.url}/api/portal/databases`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'other_blog' }) });
    expect(blockedDb.status).toBe(403);
  });

  it('attributes audited portal mutations to the team subaccount id', async () => {
    const server = await appWithSeed(['dns']); closeServer = server.close;
    const db = (await import('../db')).default;
    const login = await fetch(`${server.url}/api/portal/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'helper@example.com', password: 'team-password' }) });
    const { token } = await login.json();

    const addRecord = await fetch(`${server.url}/api/portal/domains/example.com/dns`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'www', type: 'A', value: '192.0.2.10' }),
    });
    expect(addRecord.status).toBe(200);

    const row: any = db.prepare('SELECT username, action, resource, details FROM audit_logs ORDER BY id DESC LIMIT 1').get();
    expect(row.username).toBe('helper@example.com');
    expect(row.action).toBe('POST /api/portal/domains/example.com/dns');
    expect(row.resource).toBe('example.com');
    const details = JSON.parse(row.details);
    expect(details.role).toBe('client_team');
    expect(details.team_user_id).toBe(1);
    expect(details.client_id).toBe(1);
    expect(details.account_id).toBe(1);
  });
});
