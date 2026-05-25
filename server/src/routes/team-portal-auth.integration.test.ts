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
    vi.resetModules();
  });

  afterEach(async () => {
    if (closeServer) await closeServer();
    closeServer = undefined;
    await fs.rm(tmp, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.JWT_SECRET;
    vi.resetModules();
  });

  async function appWithSeed(permissions: string[] = ['files']) {
    const db = (await import('../db')).default;
    await import('./team-users'); // creates the team_users table used by portal team login
    const portal = (await import('./client-portal')).default;
    const passwordHash = await bcrypt.hash('password123', 4);
    const clientId = Number(db.prepare("INSERT INTO clients (name,email,portal_enabled,password_hash) VALUES ('Acme','owner@example.com',1,?)").run(passwordHash).lastInsertRowid);
    const accountId = Number(db.prepare("INSERT INTO accounts (username,domain,client_id,status) VALUES ('acme','example.com',?,'active')").run(clientId).lastInsertRowid);
    db.prepare("INSERT INTO invoices (invoice_number,client_id,account_id,amount,due_date) VALUES ('INV-1',?,?,25,'2027-01-01')").run(clientId, accountId);
    const teamHash = await bcrypt.hash('team-password', 4);
    db.prepare('INSERT INTO team_users (client_id,account_id,username,email,password_hash,permissions,status) VALUES (?,?,?,?,?,?,\'active\')')
      .run(clientId, accountId, 'helper', 'helper@example.com', teamHash, JSON.stringify(permissions));
    const app = express(); app.use(express.json()); app.use('/api/portal', portal);
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
});
