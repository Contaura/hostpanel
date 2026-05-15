import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import jwt from 'jsonwebtoken';

export function setupTerminal(httpServer: HttpServer): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/api/terminal' });

  wss.on('connection', (ws: WebSocket, req) => {
    const JWT_SECRET = process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';

    // Authenticate via token in query string (WebSocket can't send headers from browser)
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(4001, 'Unauthorized: no token');
      return;
    }
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      ws.close(4001, 'Unauthorized: invalid token');
      return;
    }
    if (!['admin', 'superadmin'].includes(payload?.role)) {
      ws.close(4001, 'Unauthorized: insufficient permissions');
      return;
    }

    const shell = process.env.SHELL || '/bin/bash';

    // Strip HostPanel/server-internal secrets from the env handed to the shell.
    // The terminal is admin-only and runs as the same uid as the panel, so
    // leaking these doesn't expose anything the user couldn't read off disk —
    // but propagating them needlessly puts them in every child process env,
    // shell history, and `env`/`printenv` output. Keep the env a normal login
    // shell would expect.
    const SENSITIVE_ENV_KEYS = new Set([
      'JWT_SECRET',
      'ADMIN_PASS_HASH',
      'ADMIN_USER',
      'DB_ROOT_PASS',
      'DB_ROOT_USER',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'PAYPAL_CLIENT_SECRET',
      'CLOUDFLARE_API_TOKEN',
      'MYSQL_PWD',
    ]);
    const sanitizedEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (SENSITIVE_ENV_KEYS.has(k)) continue;
      sanitizedEnv[k] = v;
    }

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME ?? '/',
        env: sanitizedEnv,
      });
    } catch (err) {
      ws.send(`\r\nFailed to start shell: ${err}\r\n`);
      ws.close();
      return;
    }

    ptyProcess.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    ptyProcess.onExit(() => {
      if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'Shell exited');
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'input')  ptyProcess.write(msg.data);
        if (msg.type === 'resize') ptyProcess.resize(Math.max(1, msg.cols), Math.max(1, msg.rows));
      } catch {
        ptyProcess.write(raw.toString());
      }
    });

    ws.on('close', () => {
      try { ptyProcess.kill(); } catch {}
    });

    ws.on('error', () => {
      try { ptyProcess.kill(); } catch {}
    });
  });
}
