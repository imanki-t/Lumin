/**
 * terminals.js — xterm.js powered Node.js REPL and MongoDB shell.
 *
 * Fixes:
 *  - Auto-connects on navigate (no manual button click needed)
 *  - Connect button hidden when connected; Disconnect button shown instead
 *  - Only one connect() call per session (guards against double init)
 */

import { getToken } from './config.js';

// ── xterm theme ───────────────────────────────────────────────────────────────

const XTERM_THEME = {
  background:          '#060608',
  foreground:          '#E0E0EE',
  cursor:              '#6D5AE6',
  cursorAccent:        '#060608',
  selectionBackground: 'rgba(109,90,230,0.25)',
  black:               '#0C0C10',
  red:                 '#EF4444',
  green:               '#22C55E',
  yellow:              '#F59E0B',
  blue:                '#6D5AE6',
  magenta:             '#A855F7',
  cyan:                '#22D3EE',
  white:               '#E0E0EE',
  brightBlack:         '#52525B',
  brightRed:           '#F87171',
  brightGreen:         '#4ADE80',
  brightYellow:        '#FCD34D',
  brightBlue:          '#818CF8',
  brightMagenta:       '#C084FC',
  brightCyan:          '#67E8F9',
  brightWhite:         '#FFFFFF',
};

const XTERM_OPTIONS = {
  theme:             XTERM_THEME,
  cursorBlink:       true,
  cursorStyle:       'bar',
  fontSize:          13,
  fontFamily:        "'IBM Plex Mono', 'Cascadia Code', 'Fira Code', monospace",
  lineHeight:        1.45,
  letterSpacing:     0.2,
  scrollback:        3000,
  allowTransparency: true,
};

// ── State ─────────────────────────────────────────────────────────────────────

const terminals = {
  node:  { term: null, ws: null, addon: null, initialized: false, inputDispose: null },
  mongo: { term: null, ws: null, addon: null, initialized: false, inputDispose: null },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/dashboard${path}?token=${encodeURIComponent(getToken())}`;
}

function setConnected(key, connected) {
  // Badge
  const badge = document.getElementById(`${key}-conn-badge`);
  if (badge) {
    badge.className = `conn-badge ${connected ? 'connected' : ''}`;
    const label = badge.querySelector('.conn-label');
    if (label) label.textContent = connected ? 'Connected' : 'Disconnected';
  }

  // Disconnect button: show when connected
  const disconnectBtn = document.getElementById(`${key}-btn-disconnect`);
  if (disconnectBtn) disconnectBtn.style.display = connected ? 'flex' : 'none';
}

// ── Terminal init ─────────────────────────────────────────────────────────────

function initTerm(key, containerId) {
  const s = terminals[key];
  if (s.initialized) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  s.term  = new Terminal(XTERM_OPTIONS);
  s.addon = new FitAddon.FitAddon();
  s.term.loadAddon(s.addon);
  s.term.open(container);

  requestAnimationFrame(() => s.addon?.fit());
  s.initialized = true;
}

// ── Connect ───────────────────────────────────────────────────────────────────

function connect(key, wsPath) {
  const s = terminals[key];

  // Guard: don't connect if already open
  if (s.ws && s.ws.readyState < 2) return;

  setConnected(key, false);

  const ws = new WebSocket(wsUrl(wsPath));
  ws.binaryType = 'arraybuffer';
  s.ws = ws;

  ws.onopen = () => {
    setConnected(key, true);
    s.term?.writeln('\x1b[32m[Session started]\x1b[0m\r\n');
    s.addon?.fit();

    // Wire keyboard → WS (dispose previous listener first)
    if (s.inputDispose) { s.inputDispose.dispose(); s.inputDispose = null; }
    s.inputDispose = s.term?.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  ws.onmessage = (e) => {
    const text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
    s.term?.write(text);
  };

  ws.onclose = () => {
    setConnected(key, false);
    s.term?.writeln('\r\n\x1b[33m[Session closed]\x1b[0m\r\n');
    s.ws = null;
  };

  ws.onerror = () => {
    setConnected(key, false);
    s.term?.writeln('\r\n\x1b[31m[Connection error — check server logs]\x1b[0m\r\n');
    s.ws = null;
  };
}

function disconnect(key) {
  const s = terminals[key];
  if (s.ws) { s.ws.close(); s.ws = null; }
  setConnected(key, false);
}

// ── Resize handling ───────────────────────────────────────────────────────────

const ro = new ResizeObserver(() => {
  if (terminals.node.initialized)  terminals.node.addon?.fit();
  if (terminals.mongo.initialized) terminals.mongo.addon?.fit();
});

// ── Public API ────────────────────────────────────────────────────────────────

export function initNodeTerminal() {
  initTerm('node', 'node-terminal-body');
  ro.observe(document.getElementById('node-terminal-body') || document.body);

  // Auto-connect when navigating to the section
  if (!terminals.node.ws || terminals.node.ws.readyState > 1) {
    connect('node', '/ws/node');
  }
}

export function initMongoTerminal() {
  initTerm('mongo', 'mongo-terminal-body');
  ro.observe(document.getElementById('mongo-terminal-body') || document.body);

  // Auto-connect when navigating to the section
  if (!terminals.mongo.ws || terminals.mongo.ws.readyState > 1) {
    connect('mongo', '/ws/mongo');
  }
}

// Global TERM bindings for HTML onclick attributes
window.TERM = {
  disconnectNode:  () => disconnect('node'),
  clearNode:       () => terminals.node.term?.clear(),
  disconnectMongo: () => disconnect('mongo'),
  clearMongo:      () => terminals.mongo.term?.clear(),
};
