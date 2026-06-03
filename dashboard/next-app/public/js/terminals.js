// ── Terminal manager ──────────────────────────────────────────────────────────
// Manages three xterm.js terminals: Node REPL, MongoDB shell, Bash shell.
// Auth: HttpOnly session cookie is sent on the WebSocket upgrade request.

// ── Geist-aligned xterm theme ─────────────────────────────────────────────────
const THEME = {
  background:          '#050508',
  foreground:          '#e4e4f0',
  cursor:              '#8b5cf6',
  cursorAccent:        '#050508',
  selectionBackground: 'rgba(139,92,246,0.22)',

  // ANSI colours matching the Geist palette
  black:         '#18181b', red:     '#f87171', green:   '#4ade80', yellow:  '#fcd34d',
  blue:          '#818cf8', magenta: '#c084fc', cyan:    '#67e8f9', white:   '#e4e4f0',
  brightBlack:   '#52525b', brightRed:     '#fca5a5', brightGreen:  '#86efac',
  brightYellow:  '#fde68a', brightBlue:    '#a5b4fc', brightMagenta:'#d8b4fe',
  brightCyan:    '#a5f3fc', brightWhite:   '#ffffff',
};

const TERM_OPTS = {
  theme:            THEME,
  cursorBlink:      true,
  cursorStyle:      'bar',
  fontSize:         13,
  fontFamily:       "'Geist Mono','JetBrains Mono','Fira Code','Cascadia Code',monospace",
  lineHeight:       1.45,
  scrollback:       5000,
  allowTransparency: true,
  convertEol:       true,
};

// ── Per-terminal state ────────────────────────────────────────────────────────
const T = {
  node:  { term: null, ws: null, addon: null, ready: false, inputDispose: null },
  mongo: { term: null, ws: null, addon: null, ready: false, inputDispose: null },
  shell: { term: null, ws: null, addon: null, ready: false, inputDispose: null },
};

const WS_PATH = { node: '/ws/node', mongo: '/ws/mongo', shell: '/ws/shell' };

const wsUrl = path =>
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/dashboard${path}`;

// ── Badge / button helpers ────────────────────────────────────────────────────
function setConnState(key, state) {
  const badge = document.getElementById(`${key}-badge`);
  if (badge) {
    const connected    = state === 'ok';
    const reconnecting = state === 'warn';

    badge.className = `conn-pill${connected ? ' ok' : reconnecting ? ' warn' : ''}`;

    const lbl = badge.querySelector('.conn-pill-lbl');
    if (lbl) lbl.textContent = connected ? 'Connected' : reconnecting ? 'Reconnecting…' : 'Disconnected';
  }

  document.getElementById(`${key}-disconnect`)?.classList.toggle('hidden', state !== 'ok');
  document.getElementById(`${key}-reconnect`)?.classList.toggle('hidden',  state !== 'disconnected');
}

// ── Resize observer ───────────────────────────────────────────────────────────
const ro = new ResizeObserver(() => {
  for (const s of Object.values(T)) {
    if (s.ready) s.addon?.fit();
  }
});

// ── Terminal init ─────────────────────────────────────────────────────────────
function initTerm(key, containerId) {
  const s = T[key];
  if (s.ready) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  s.term  = new Terminal(TERM_OPTS);     // eslint-disable-line no-undef
  s.addon = new FitAddon.FitAddon();     // eslint-disable-line no-undef
  s.term.loadAddon(s.addon);
  s.term.open(container);

  requestAnimationFrame(() => {
    s.addon?.fit();
    s.term?.focus();
  });

  ro.observe(container);
  container.addEventListener('click', () => s.term?.focus());
  s.ready = true;
}

// ── WebSocket connect ─────────────────────────────────────────────────────────
function connect(key) {
  const s    = T[key];
  const path = WS_PATH[key];

  // Don't re-connect if already open or connecting
  if (s.ws && s.ws.readyState < WebSocket.CLOSING) return;

  setConnState(key, 'warn');
  const ws = new WebSocket(wsUrl(path));
  ws.binaryType = 'arraybuffer';
  s.ws = ws;

  ws.addEventListener('open', () => {
    setConnState(key, 'ok');
    s.term?.writeln('\x1b[32m[Connected — start typing]\x1b[0m\r');
    s.addon?.fit();
    s.term?.focus();

    // Clean up any previous input listener
    s.inputDispose?.dispose();

    // Forward keystrokes to the server; echo locally (spawn uses pipes, not PTY)
    s.inputDispose = s.term?.onData(data => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(data);

      // Local echo
      if (data === '\r') {
        s.term.write('\r\n');
      } else if (data === '\x7f' || data === '\b') {
        s.term.write('\b \b');
      } else if (data.length === 1 && data.charCodeAt(0) >= 32) {
        s.term.write(data);
      }
    });
  });

  ws.addEventListener('message', e => {
    const text = typeof e.data === 'string'
      ? e.data
      : new TextDecoder().decode(e.data);
    s.term?.write(text);
  });

  ws.addEventListener('close', () => {
    setConnState(key, 'disconnected');
    s.term?.writeln('\r\n\x1b[33m[Session closed — click Reconnect to resume]\x1b[0m\r');
    s.inputDispose?.dispose();
    s.inputDispose = null;
    s.ws = null;
  });

  ws.addEventListener('error', () => {
    setConnState(key, 'disconnected');
    s.term?.writeln('\r\n\x1b[31m[Connection error — check server logs]\x1b[0m\r');
    s.inputDispose?.dispose();
    s.inputDispose = null;
    s.ws = null;
  });
}

// ── Disconnect ────────────────────────────────────────────────────────────────
function disconnect(key) {
  T[key].inputDispose?.dispose();
  T[key].inputDispose = null;
  T[key].ws?.close();
  T[key].ws = null;
  setConnState(key, 'disconnected');
}

// ── Public init (called by router on first visit to a console section) ────────
export function initNodeTerminal()  {
  initTerm('node',  'node-body');
  connect('node');
}

export function initMongoTerminal() {
  initTerm('mongo', 'mongo-body');
  connect('mongo');
}

export function initShellTerminal() {
  initTerm('shell', 'shell-body');
  connect('shell');
}

// ── window.TERM — wired up by _document.jsx buttons ──────────────────────────
window.TERM = {
  // Node
  disconnectNode:  () => disconnect('node'),
  reconnectNode:   () => {
    T.node.term?.writeln('\x1b[36m[Reconnecting…]\x1b[0m\r');
    connect('node');
  },
  clearNode: () => T.node.term?.clear(),

  // Mongo
  disconnectMongo: () => disconnect('mongo'),
  reconnectMongo:  () => {
    T.mongo.term?.writeln('\x1b[36m[Reconnecting…]\x1b[0m\r');
    connect('mongo');
  },
  clearMongo: () => T.mongo.term?.clear(),

  // Shell
  disconnectShell: () => disconnect('shell'),
  reconnectShell:  () => {
    T.shell.term?.writeln('\x1b[36m[Reconnecting…]\x1b[0m\r');
    connect('shell');
  },
  clearShell: () => T.shell.term?.clear(),
};
