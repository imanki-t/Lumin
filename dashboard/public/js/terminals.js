/**
 * terminals.js — xterm.js powered Node.js REPL and MongoDB shell.
 */

import { getToken } from './config.js';
import { toastInfo, toastErr } from './toast.js';

// ── Theme ─────────────────────────────────────────────────────────────────────

const XTERM_THEME = {
  background:        '#080A0D',
  foreground:        '#F4F1EC',
  cursor:            '#CF6A37',
  cursorAccent:      '#0C0C0E',
  selectionBackground: 'rgba(207,106,55,0.25)',
  black:             '#0C0C0E',
  red:               '#D95F5F',
  green:             '#3E9E6E',
  yellow:            '#C9924A',
  blue:              '#5B8FD4',
  magenta:           '#9B7FD4',
  cyan:              '#4EB8B8',
  white:             '#F4F1EC',
  brightBlack:       '#625F5A',
  brightRed:         '#E07070',
  brightGreen:       '#4EAE7E',
  brightYellow:      '#D4A460',
  brightBlue:        '#6B9FE4',
  brightMagenta:     '#AB8FE4',
  brightCyan:        '#5EC8C8',
  brightWhite:       '#FFFFFF',
};

const XTERM_OPTIONS = {
  theme:             XTERM_THEME,
  cursorBlink:       true,
  cursorStyle:       'bar',
  fontSize:          13,
  fontFamily:        "'Geist Mono', 'Cascadia Code', 'Fira Code', monospace",
  lineHeight:        1.4,
  letterSpacing:     0.3,
  scrollback:        2000,
  allowTransparency: true,
};

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  node:  { term: null, ws: null, addon: null, initialized: false },
  mongo: { term: null, ws: null, addon: null, initialized: false },
};

// ── WS URL ────────────────────────────────────────────────────────────────────

function wsUrl(path) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/dashboard${path}?token=${encodeURIComponent(getToken())}`;
}

// ── Generic init ──────────────────────────────────────────────────────────────

function initTerm(key, containerId) {
  const s = state[key];
  if (s.initialized) return;

  const container = document.getElementById(containerId);
  if (!container) return;

  s.term  = new Terminal(XTERM_OPTIONS);
  s.addon = new FitAddon.FitAddon();
  s.term.loadAddon(s.addon);
  s.term.open(container);

  requestAnimationFrame(() => {
    s.addon.fit();
  });

  s.initialized = true;

  const hint = key === 'node'
    ? '\x1b[90mNode.js REPL ready. Press Connect to start a session.\x1b[0m\r\n'
    : '\x1b[90mMongoDB shell ready. Press Connect to start a session.\x1b[0m\r\n';
  s.term.writeln(hint);
}

// ── Connect ───────────────────────────────────────────────────────────────────

function connect(key, wsPath, statusId) {
  const s = state[key];

  if (s.ws && s.ws.readyState < 2) {
    toastInfo('Already connected');
    return;
  }

  const statusEl = document.getElementById(statusId);
  const setStatus = (connected) => {
    if (!statusEl) return;
    statusEl.className  = `terminal-conn-badge ${connected ? 'connected' : 'disconnected'}`;
    statusEl.textContent = connected ? 'Connected' : 'Disconnected';
  };

  setStatus(false);

  const ws = new WebSocket(wsUrl(wsPath));
  ws.binaryType = 'arraybuffer';
  s.ws = ws;

  ws.onopen = () => {
    setStatus(true);
    s.term.writeln('\x1b[32m[Session started]\x1b[0m\r\n');

    // Wire terminal input to WS
    s.term.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    s.addon?.fit();
  };

  ws.onmessage = (e) => {
    const text = typeof e.data === 'string'
      ? e.data
      : new TextDecoder().decode(e.data);
    s.term.write(text);
  };

  ws.onclose = () => {
    setStatus(false);
    s.term.writeln('\r\n\x1b[33m[Session closed]\x1b[0m\r\n');
  };

  ws.onerror = () => {
    setStatus(false);
    s.term.writeln('\r\n\x1b[31m[WebSocket error — check secret and server]\x1b[0m\r\n');
    toastErr('Terminal connection failed');
  };
}

function disconnect(key, statusId) {
  const s = state[key];
  if (s.ws) {
    s.ws.close();
    s.ws = null;
  }
  const statusEl = document.getElementById(statusId);
  if (statusEl) {
    statusEl.className  = 'terminal-conn-badge disconnected';
    statusEl.textContent = 'Disconnected';
  }
}

function clearTerm(key) {
  state[key].term?.clear();
}

// ── Resize observer ───────────────────────────────────────────────────────────

function setupResizeObserver() {
  const ro = new ResizeObserver(() => {
    if (state.node.initialized)  state.node.addon?.fit();
    if (state.mongo.initialized) state.mongo.addon?.fit();
  });

  ['node-terminal-body', 'mongo-terminal-body'].forEach(id => {
    const el = document.getElementById(id);
    if (el) ro.observe(el);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initNodeTerminal() {
  initTerm('node', 'node-terminal-body');
  setupResizeObserver();
}

export function initMongoTerminal() {
  initTerm('mongo', 'mongo-terminal-body');
  setupResizeObserver();
}

// Exposed globally for onclick handlers in HTML
window.TERM = {
  connectNode:       () => connect('node',  '/ws/node',  'node-conn-badge'),
  disconnectNode:    () => disconnect('node', 'node-conn-badge'),
  clearNode:         () => clearTerm('node'),

  connectMongo:      () => connect('mongo', '/ws/mongo', 'mongo-conn-badge'),
  disconnectMongo:   () => disconnect('mongo', 'mongo-conn-badge'),
  clearMongo:        () => clearTerm('mongo'),
};
