import { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as pty from 'node-pty';
import jwt from 'jsonwebtoken';
import db from './db';

const DEFAULT_TERMINAL_SHELL = '/bin/bash';
const ALLOWED_TERMINAL_SHELLS = new Set(['/bin/bash', '/usr/bin/bash', '/bin/sh', '/usr/bin/sh']);
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
const SENSITIVE_ENV_PATTERNS = [/_TOKEN$/i, /_SECRET$/i, /_PASSWORD$/i, /_PRIVATE_KEY$/i, /^SECRET_/i];

export function selectTerminalShell(candidate: string | undefined): string {
  if (!candidate) return DEFAULT_TERMINAL_SHELL;
  return ALLOWED_TERMINAL_SHELLS.has(candidate) ? candidate : DEFAULT_TERMINAL_SHELL;
}

export function sanitizeTerminalEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const sanitizedEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    if (SENSITIVE_ENV_KEYS.has(k)) continue;
    if (SENSITIVE_ENV_PATTERNS.some(pattern => pattern.test(k))) continue;
    sanitizedEnv[k] = v;
  }
  return sanitizedEnv;
}

function auditTerminal(username: string, ip: string, details: Record<string, unknown>) {
  try {
    db.prepare("INSERT INTO audit_logs (username, action, resource, details, ip) VALUES (?, ?, ?, ?, ?)")
      .run(username || 'anonymous', 'OPEN /api/terminal', 'terminal', JSON.stringify(details), ip);
  } catch (_) {}
}

export function setupTerminal(httpServer: HttpServer): void {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/terminal',
    // Browsers refuse the connection unless the server echoes a chosen
    // subprotocol back. The token-carrying entry is `hp-token.<jwt>`; we
    // accept it (and any other client-offered protocol) so the handshake
    // succeeds. The actual auth check happens in the connection handler.
    handleProtocols: (protocols) => {
      const arr = Array.isArray(protocols) ? protocols : Array.from(protocols as Iterable<string>);
      const tokenEntry = arr.find(p => p.startsWith('hp-token.'));
      return tokenEntry || arr[0] || false;
    },
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const JWT_SECRET = process.env.JWT_SECRET || 'hostpanel-secret-change-in-production';

    // Pull the JWT from the Sec-WebSocket-Protocol header (the only request-
    // time header a browser can attach to `new WebSocket`). The client wraps
    // the token as `hp-token.<jwt>` so we can distinguish it from any other
    // subprotocol entry. Legacy clients that still send ?token=… in the URL
    // query string fall back to the URL path during the rollout window.
    const protoHdr = (req.headers['sec-websocket-protocol'] as string | undefined) || '';
    const protoEntries = protoHdr.split(',').map(s => s.trim()).filter(Boolean);
    const protoToken = protoEntries.find(p => p.startsWith('hp-token.'))?.slice('hp-token.'.length);
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const queryToken = url.searchParams.get('token');
    const token = protoToken || queryToken;

    if (!token) {
      ws.close(4001, 'Unauthorized: no token');
      return;
    }
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch {
      ws.close(4001, 'Unauthorized: invalid token');
      return;
    }
    if (!['admin', 'superadmin'].includes(payload?.role)) {
      ws.close(4001, 'Unauthorized: insufficient permissions');
      return;
    }

    const shell = selectTerminalShell(process.env.SHELL);
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    auditTerminal(payload?.username || 'anonymous', ip, { role: payload?.role, shell });

    // Strip HostPanel/server-internal secrets from the env handed to the shell.
    // The terminal is admin-only and runs as the same uid as the panel, so
    // leaking these doesn't expose anything the user couldn't read off disk —
    // but propagating them needlessly puts them in every child process env,
    // shell history, and `env`/`printenv` output. Keep the env a normal login
    // shell would expect.
    const sanitizedEnv = sanitizeTerminalEnv(process.env);

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
