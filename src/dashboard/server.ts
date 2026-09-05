import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { env } from '@/config/env.js';
import { apiRouter } from './routes/api.js';
import { WSMetricsBroadcaster } from './ws-metrics.js';
import { Logger } from '@/core/logger/index.js';

const logger = Logger.get('DashboardServer');

export class DashboardServer {
  private static instance: DashboardServer;
  private app: express.Express;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;

  private constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  public static get(): DashboardServer {
    if (!DashboardServer.instance) {
      DashboardServer.instance = new DashboardServer();
    }
    return DashboardServer.instance;
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS & Security headers
    this.app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  private setupRoutes(): void {
    // Health check endpoint
    this.app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Mount API routes
    this.app.use('/api', apiRouter);

    // Modern Embedded Real-time Dashboard UI
    this.app.get('/', (_req, res) => {
      res.redirect('/dashboard');
    });

    this.app.get('/dashboard', (_req: Request, res: Response) => {
      res.send(this.renderDashboardHtml());
    });
  }

  private renderDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lumin AI • Mission Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0d1117; color: #c9d1d9; font-family: ui-sans-serif, system-ui, sans-serif; }
    .glass { background: rgba(22, 27, 34, 0.75); backdrop-filter: blur(12px); border: 1px solid rgba(48, 54, 61, 0.8); }
    .badge-online { background-color: rgba(35, 134, 54, 0.2); color: #3fb950; border: 1px solid #238636; }
    .glow { box-shadow: 0 0 15px rgba(88, 101, 242, 0.35); }
  </style>
</head>
<body class="min-h-screen p-6 md:p-10">
  <header class="flex flex-col md:flex-row justify-between items-center mb-8 gap-4 border-b border-gray-800 pb-6">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-black text-xl text-white glow">L</div>
      <div>
        <h1 class="text-2xl font-bold text-white tracking-wide">Lumin Mission Control</h1>
        <p class="text-xs text-gray-400">Enterprise Discord Bot • Autonomous AI Architecture</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <span id="bot-status" class="px-3 py-1 rounded-full text-xs font-semibold badge-online">INITIALIZING</span>
      <span id="gateway-ping" class="text-sm font-mono bg-gray-800 px-3 py-1 rounded-lg border border-gray-700">-- ms</span>
      <button onclick="toggleLockdown()" id="lockdown-btn" class="bg-red-950 hover:bg-red-900 text-red-400 border border-red-800 text-xs px-3 py-1.5 rounded-lg transition font-medium">Emergency Lockdown</button>
    </div>
  </header>

  <main class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
    <div class="glass p-5 rounded-2xl">
      <div class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Guilds Serving</div>
      <div id="stat-guilds" class="text-3xl font-bold text-white">--</div>
      <div class="text-xs text-green-400 mt-2">Active Shards Healthy</div>
    </div>
    <div class="glass p-5 rounded-2xl">
      <div class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Memory (RSS / Heap)</div>
      <div id="stat-mem" class="text-3xl font-bold text-indigo-400">-- MB</div>
      <div id="stat-mem-sub" class="text-xs text-gray-400 mt-2">Heap: -- MB</div>
    </div>
    <div class="glass p-5 rounded-2xl">
      <div class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">CPU & Load Avg</div>
      <div id="stat-cpu" class="text-3xl font-bold text-yellow-400">--%</div>
      <div id="stat-load" class="text-xs text-gray-400 mt-2">Load: [0.0, 0.0, 0.0]</div>
    </div>
    <div class="glass p-5 rounded-2xl">
      <div class="text-xs text-gray-400 font-semibold uppercase tracking-wider mb-2">Active User Queues</div>
      <div id="stat-queues" class="text-3xl font-bold text-cyan-400">--</div>
      <div class="text-xs text-gray-400 mt-2">Zero-Blocking Memory Pipeline</div>
    </div>
  </main>

  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
    <!-- AI Key Rotation Pool -->
    <section class="glass p-6 rounded-2xl">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold text-white">Gemini API Key Pool</h2>
        <button onclick="rotateKey()" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg transition font-medium">Force Rotate</button>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-gray-700 text-xs text-gray-400">
              <th class="pb-2">Masked Key</th>
              <th class="pb-2">Health</th>
              <th class="pb-2">Requests</th>
              <th class="pb-2">Errors</th>
            </tr>
          </thead>
          <tbody id="keys-tbody" class="divide-y divide-gray-800">
            <tr><td colspan="4" class="py-4 text-center text-gray-500">Connecting to telemetry stream...</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Administrative REPL Terminal -->
    <section class="glass p-6 rounded-2xl flex flex-col">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold text-white">Live Node.js Admin REPL</h2>
        <span class="text-xs text-gray-400">Context: { db, redis, client, aiRouter }</span>
      </div>
      <textarea id="repl-input" class="w-full h-24 bg-gray-950 border border-gray-800 rounded-lg p-3 font-mono text-sm text-green-400 focus:outline-none focus:border-indigo-500" placeholder="client.guilds.cache.map(g => g.name)"></textarea>
      <div class="flex justify-between items-center mt-3">
        <button onclick="runRepl()" class="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded-lg font-semibold transition">Execute Code</button>
        <span id="repl-time" class="text-xs font-mono text-gray-500"></span>
      </div>
      <pre id="repl-output" class="mt-3 p-3 bg-gray-950 border border-gray-900 rounded-lg text-xs font-mono text-gray-300 max-h-36 overflow-y-auto">// Output will appear here</pre>
    </section>
  </div>

  <footer class="text-center text-xs text-gray-500 border-t border-gray-900 pt-6">
    Lumin v4.0.0 • Industrial-Grade Architecture • Powered by Google Gemini 3.5 & Gemma
  </footer>

  <script>
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(wsProto + '//' + window.location.host);

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      document.getElementById('bot-status').innerText = data.discord.status;
      document.getElementById('gateway-ping').innerText = data.discord.pingMs + ' ms';
      document.getElementById('stat-guilds').innerText = data.discord.guildCount.toLocaleString();
      document.getElementById('stat-mem').innerText = data.process.rssMb + ' MB';
      document.getElementById('stat-mem-sub').innerText = 'Heap: ' + data.process.heapUsedMb + ' MB / ' + data.process.heapTotalMb + ' MB';
      document.getElementById('stat-cpu').innerText = data.system.memUsagePercent + '%';
      document.getElementById('stat-load').innerText = 'Load: [' + data.system.loadAvg.map(n => n.toFixed(2)).join(', ') + ']';
      document.getElementById('stat-queues').innerText = data.queues.activeUsersCount;

      const keysTbody = document.getElementById('keys-tbody');
      if (data.aiKeys && data.aiKeys.length > 0) {
        keysTbody.innerHTML = data.aiKeys.map(k => \`
          <tr class="text-xs">
            <td class="py-2 font-mono text-indigo-300">\${k.maskedKey}</td>
            <td class="py-2"><span class="\${k.isHealthy ? 'text-green-400' : 'text-red-400'} font-semibold">\${k.isHealthy ? 'HEALTHY' : 'COOLDOWN'}</span></td>
            <td class="py-2 font-mono">\${k.totalRequests}</td>
            <td class="py-2 font-mono \${k.totalErrors > 0 ? 'text-yellow-400' : 'text-gray-400'}">\${k.totalErrors}</td>
          </tr>
        \`).join('');
      }
    };

    async function toggleLockdown() {
      const res = await fetch('/api/lockdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      alert('Lockdown state: ' + (data.isGlobalLockdown ? 'ACTIVE' : 'DISABLED'));
    }

    async function rotateKey() {
      const res = await fetch('/api/keys/rotate', { method: 'POST' });
      const data = await res.json();
      alert('Switched to key: ' + data.activeKey);
    }

    async function runRepl() {
      const code = document.getElementById('repl-input').value;
      const out = document.getElementById('repl-output');
      const time = document.getElementById('repl-time');
      out.innerText = 'Running...';
      try {
        const res = await fetch('/api/terminal/js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
        const data = await res.json();
        time.innerText = data.executionTimeMs ? data.executionTimeMs + 'ms' : '';
        out.innerText = JSON.stringify(data.result, null, 2) || data.error;
      } catch (err) {
        out.innerText = 'Error: ' + err.message;
      }
    }
  </script>
</body>
</html>`;
  }

  /**
   * Starts HTTP and WebSocket server
   */
  public async start(): Promise<void> {
    const port = env.PORT;
    this.server = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });

    WSMetricsBroadcaster.get().init(this.wss);

    return new Promise((resolve) => {
      this.server!.listen(port, () => {
        logger.info(`Dashboard and API server listening at http://localhost:${port}`);
        resolve();
      });
    });
  }

  /**
   * Stops HTTP and WebSocket server
   */
  public async stop(): Promise<void> {
    logger.info('Stopping Dashboard HTTP and WebSocket server...');
    WSMetricsBroadcaster.get().stop();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }
    logger.info('Dashboard server stopped.');
  }
}
