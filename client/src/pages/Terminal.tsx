import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { TerminalSquare, Wifi, WifiOff, Maximize2, Minimize2 } from 'lucide-react';

const THEME = {
  background:   '#0f172a',
  foreground:   '#e2e8f0',
  cursor:       '#818cf8',
  cursorAccent: '#0f172a',
  selectionBackground: 'rgba(129,140,248,0.3)',
  black:        '#1e293b',
  red:          '#f87171',
  green:        '#34d399',
  yellow:       '#fbbf24',
  blue:         '#60a5fa',
  magenta:      '#c084fc',
  cyan:         '#22d3ee',
  white:        '#e2e8f0',
  brightBlack:  '#475569',
  brightRed:    '#fca5a5',
  brightGreen:  '#6ee7b7',
  brightYellow: '#fde68a',
  brightBlue:   '#93c5fd',
  brightMagenta:'#d8b4fe',
  brightCyan:   '#67e8f9',
  brightWhite:  '#f8fafc',
};

type ConnStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);
  const wsRef        = useRef<WebSocket | null>(null);
  const [status, setStatus]   = useState<ConnStatus>('connecting');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // --- Terminal ---
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.3,
      fontFamily: '"Cascadia Code", "Fira Code", Menlo, Monaco, "Courier New", monospace',
      theme: THEME,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fitAddon  = new FitAddon();
    const linksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(linksAddon);
    term.open(container);
    fitAddon.fit();
    termRef.current = term;
    fitRef.current  = fitAddon;

    // --- WebSocket ---
    const token = localStorage.getItem('hp_token') ?? '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/api/terminal?token=${encodeURIComponent(token)}`);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      setStatus('connected');
      // Send initial size
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = e => {
      if (e.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data as string);
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      setStatus('disconnected');
      term.write('\r\n\x1b[1;31m── Connection closed ──\x1b[0m\r\n');
    };

    term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // --- Resize observer ---
    const ro = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
      wsRef.current   = null;
    };
  }, []);

  function reconnect() {
    wsRef.current?.close();
    termRef.current?.clear();
    setStatus('connecting');
    // Re-mount by re-rendering — simplest: just force a page reload of the component
    // We'll achieve this via the key prop trick at the parent, but here we trigger
    // a new connection by disposing and recreating
    window.location.reload();
  }

  const statusConfig: Record<ConnStatus, { label: string; color: string; dot: string }> = {
    connecting:   { label: 'Connecting…', color: 'text-amber-500', dot: 'bg-amber-400 animate-pulse' },
    connected:    { label: 'Connected',   color: 'text-emerald-500', dot: 'bg-emerald-400 animate-pulse' },
    disconnected: { label: 'Disconnected', color: 'text-slate-400', dot: 'bg-slate-400' },
    error:        { label: 'Error',        color: 'text-rose-500',  dot: 'bg-rose-400' },
  };
  const sc = statusConfig[status];

  return (
    <div className={`space-y-4 ${fullscreen ? 'fixed inset-0 z-50 bg-slate-950 p-4 flex flex-col' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Terminal</h1>
          <p className="page-subtitle">Web-based shell access to this server</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Status */}
          <div className={`flex items-center gap-2 text-sm font-medium ${sc.color}`}>
            <div className={`h-2 w-2 rounded-full ${sc.dot}`} />
            {sc.label}
          </div>

          {/* Reconnect if not connected */}
          {status !== 'connected' && (
            <button onClick={reconnect} className="btn-secondary text-xs">
              Reconnect
            </button>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setFullscreen(v => !v)}
            className="btn-icon"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      <div
        className={`rounded-xl overflow-hidden border border-slate-700/60 shadow-xl shadow-slate-950/50 ${fullscreen ? 'flex-1' : ''}`}
        style={{ background: THEME.background }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5">
          <div className="h-3 w-3 rounded-full bg-rose-500/80" />
          <div className="h-3 w-3 rounded-full bg-amber-400/80" />
          <div className="h-3 w-3 rounded-full bg-emerald-500/80" />
          <div className="flex items-center gap-1.5 ml-3">
            <TerminalSquare size={12} className="text-slate-500" />
            <span className="text-xs text-slate-500 font-mono select-none">bash — HostPanel Terminal</span>
          </div>
        </div>

        {/* xterm container */}
        <div
          ref={containerRef}
          style={{ height: fullscreen ? 'calc(100% - 40px)' : '65vh', padding: '8px 4px 4px' }}
        />
      </div>

      {!fullscreen && (
        <p className="text-xs text-slate-500 dark:text-slate-600">
          This terminal runs as the same user as the HostPanel server process. Use with care.
        </p>
      )}
    </div>
  );
}
