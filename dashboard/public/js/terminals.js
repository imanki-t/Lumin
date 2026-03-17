import { getToken } from './config.js';

const THEME = {
  background:          '#070709',
  foreground:          '#E4E4F0',
  cursor:              '#6D5AE6',
  cursorAccent:        '#070709',
  selectionBackground: 'rgba(109,90,230,0.3)',
  black:   '#1A1A25', red:     '#FF6B6B', green:   '#4ADE80',
  yellow:  '#FCD34D', blue:    '#818CF8', magenta: '#C084FC',
  cyan:    '#67E8F9', white:   '#E4E4F0',
  brightBlack:   '#555570', brightRed:     '#FF8585', brightGreen:   '#6BEE96',
  brightYellow:  '#FDDF75', brightBlue:    '#A5B4FC', brightMagenta: '#D8B4FE',
  brightCyan:    '#93F0FF', brightWhite:   '#FFFFFF',
};

const OPTS = {
  theme: THEME, cursorBlink: true, cursorStyle: 'bar',
  fontSize: 13, fontFamily: "'IBM Plex Mono','Cascadia Code','Fira Code',monospace",
  lineHeight: 1.45, letterSpacing: 0.2, scrollback: 5000,
  allowTransparency: true,
  disableStdin: false,
  convertEol: true,
};

const T = {
  node:  { term:null, ws:null, addon:null, ready:false, inputDispose:null },
  mongo: { term:null, ws:null, addon:null, ready:false, inputDispose:null },
};

function wsUrl(path) {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/dashboard${path}?token=${encodeURIComponent(getToken())}`;
}

function setConn(key, state) {
  // state: 'connected' | 'disconnected' | 'reconnecting'
  const badge = document.getElementById(`${key}-badge`);
  if (badge) {
    badge.className = `conn-badge ${state === 'connected' ? 'connected' : state === 'reconnecting' ? 'reconnecting' : ''}`;
    const lbl = badge.querySelector('.conn-lbl');
    if (lbl) lbl.textContent = state === 'connected' ? 'Connected' : state === 'reconnecting' ? 'Reconnecting…' : 'Disconnected';
  }
  const discBtn = document.getElementById(`${key}-disconnect`);
  const reconBtn = document.getElementById(`${key}-reconnect`);
  if (discBtn) discBtn.classList.toggle('hidden', state !== 'connected');
  if (reconBtn) reconBtn.classList.toggle('hidden', state !== 'disconnected');
}

function initTerm(key, containerId) {
  const s = T[key];
  if (s.ready) return;
  const el = document.getElementById(containerId);
  if (!el) return;
  s.term  = new Terminal(OPTS);
  s.addon = new FitAddon.FitAddon();
  s.term.loadAddon(s.addon);
  s.term.open(el);
  // Force focus so typing is captured immediately
  s.term.focus();
  requestAnimationFrame(() => { s.addon?.fit(); s.term?.focus(); });
  s.ready = true;
}

function connect(key, path) {
  const s = T[key];
  if (s.ws && s.ws.readyState < 2) return;

  setConn(key, 'reconnecting');
  const ws = new WebSocket(wsUrl(path));
  ws.binaryType = 'arraybuffer';
  s.ws = ws;

  ws.onopen = () => {
    setConn(key, 'connected');
    s.term?.writeln('\x1b[32m[Session started — click here and type your commands]\x1b[0m\r\n');
    s.addon?.fit();
    s.term?.focus();
    // Bind input: every keypress → send raw to server
    if (s.inputDispose) { s.inputDispose.dispose(); s.inputDispose = null; }
    s.inputDispose = s.term?.onData(data => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
  };

  ws.onmessage = e => {
    const text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
    s.term?.write(text);
  };

  ws.onclose = () => {
    setConn(key, 'disconnected');
    s.term?.writeln('\r\n\x1b[33m[Session closed — click Reconnect to start a new session]\x1b[0m\r\n');
    // Dispose input binding so we don't send to dead socket
    if (s.inputDispose) { s.inputDispose.dispose(); s.inputDispose = null; }
    s.ws = null;
  };

  ws.onerror = () => {
    setConn(key, 'disconnected');
    s.term?.writeln('\r\n\x1b[31m[Connection error]\x1b[0m\r\n');
    if (s.inputDispose) { s.inputDispose.dispose(); s.inputDispose = null; }
    s.ws = null;
  };
}

function disconnect(key) {
  if (T[key].inputDispose) { T[key].inputDispose.dispose(); T[key].inputDispose = null; }
  T[key].ws?.close();
  T[key].ws = null;
  setConn(key, 'disconnected');
}

const ro = new ResizeObserver(() => {
  if (T.node.ready)  T.node.addon?.fit();
  if (T.mongo.ready) T.mongo.addon?.fit();
});

export function initNodeTerminal() {
  initTerm('node', 'node-body');
  const el = document.getElementById('node-body');
  if (el) ro.observe(el);
  // Click on terminal body → focus the terminal
  el?.addEventListener('click', () => T.node.term?.focus());
  if (!T.node.ws || T.node.ws.readyState > 1) connect('node', '/ws/node');
}

export function initMongoTerminal() {
  initTerm('mongo', 'mongo-body');
  const el = document.getElementById('mongo-body');
  if (el) ro.observe(el);
  el?.addEventListener('click', () => T.mongo.term?.focus());
  if (!T.mongo.ws || T.mongo.ws.readyState > 1) connect('mongo', '/ws/mongo');
}

window.TERM = {
  disconnectNode:  () => disconnect('node'),
  reconnectNode:   () => { T.node.term?.writeln('\x1b[36m[Reconnecting…]\x1b[0m\r\n'); connect('node', '/ws/node'); },
  clearNode:       () => T.node.term?.clear(),
  disconnectMongo: () => disconnect('mongo'),
  reconnectMongo:  () => { T.mongo.term?.writeln('\x1b[36m[Reconnecting…]\x1b[0m\r\n'); connect('mongo', '/ws/mongo'); },
  clearMongo:      () => T.mongo.term?.clear(),
};
