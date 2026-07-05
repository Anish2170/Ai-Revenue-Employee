import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { config } from '../config/index.js';

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

interface DomSnapshot {
  readyState: string;
  bodyText: string;
  headingCount: number;
  paragraphCount: number;
  linkCount: number;
  html: string;
}

export interface RenderedPage {
  url: string;
  status: number | null;
  readyState: string;
  bodyText: string;
  headingCount: number;
  paragraphCount: number;
  linkCount: number;
  html: string;
  waitStrategy: string[];
}

class CdpClient {
  private nextId = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private handlers = new Map<string, Set<(params: unknown) => void>>();

  private constructor(private readonly ws: any) {
    ws.addEventListener('message', (event: { data: unknown }) => this.onMessage(event.data));
    ws.addEventListener('close', () => this.rejectAll(new Error('Chrome DevTools connection closed.')));
    ws.addEventListener('error', () => this.rejectAll(new Error('Chrome DevTools connection error.')));
  }

  static async connect(wsUrl: string, timeoutMs: number): Promise<CdpClient> {
    const WebSocketCtor = (globalThis as unknown as { WebSocket?: new (url: string) => any }).WebSocket;
    if (!WebSocketCtor) throw new Error('Global WebSocket is not available in this Node runtime.');

    const ws = new WebSocketCtor(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chrome DevTools.')), timeoutMs);
      ws.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Failed to connect to Chrome DevTools.'));
      }, { once: true });
    });
    return new CdpClient(ws);
  }

  on(method: string, handler: (params: unknown) => void): () => void {
    const set = this.handlers.get(method) ?? new Set<(params: unknown) => void>();
    set.add(handler);
    this.handlers.set(method, set);
    return () => set.delete(handler);
  }

  once(method: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params) => {
        clearTimeout(timer);
        off();
        resolve(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${method}.`));
      }, timeoutMs);
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.ws.send(payload);
    });
  }

  close(): void {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }

  private onMessage(data: unknown): void {
    const text = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8');
    let msg: CdpMessage;
    try {
      msg = JSON.parse(text) as CdpMessage;
    } catch {
      return;
    }

    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message ?? 'Chrome DevTools command failed.'));
      else pending.resolve(msg.result);
      return;
    }

    if (msg.method) {
      for (const handler of this.handlers.get(msg.method) ?? []) handler(msg.params);
    }
  }

  private rejectAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}

export async function renderPage(url: string, timeoutMs: number): Promise<RenderedPage> {
  const executable = findBrowserExecutable();
  if (!executable) throw new Error('No Chrome/Edge executable found. Set CRAWL_BROWSER_PATH or CHROME_PATH.');

  const userDataDir = await mkdtemp(join(tmpdir(), 'aire-crawl-chrome-'));
  let chrome: ChildProcess | null = null;
  let client: CdpClient | null = null;

  try {
    chrome = spawn(executable, [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-background-networking',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    const port = await waitForDevToolsPort(userDataDir, chrome, Math.min(timeoutMs, 10_000));
    const target = await createTarget(port, Math.min(timeoutMs, 10_000));
    client = await CdpClient.connect(target.webSocketDebuggerUrl, Math.min(timeoutMs, 10_000));

    const activeRequests = new Set<string>();
    let lastNetworkChange = Date.now();
    let status: number | null = null;
    let responseUrl = url;

    client.on('Network.requestWillBeSent', (params) => {
      const p = params as { requestId?: string; type?: string };
      if (p.requestId && p.type !== 'Image') activeRequests.add(p.requestId);
      lastNetworkChange = Date.now();
    });
    const clearRequest = (params: unknown) => {
      const p = params as { requestId?: string };
      if (p.requestId) activeRequests.delete(p.requestId);
      lastNetworkChange = Date.now();
    };
    client.on('Network.loadingFinished', clearRequest);
    client.on('Network.loadingFailed', clearRequest);
    client.on('Network.responseReceived', (params) => {
      const p = params as { type?: string; response?: { status?: number; url?: string } };
      if (p.type === 'Document' && p.response) {
        status = typeof p.response.status === 'number' ? p.response.status : status;
        responseUrl = p.response.url ?? responseUrl;
      }
    });

    await client.send('Page.enable');
    await client.send('Network.enable');
    await client.send('Runtime.enable');

    const waitStrategy = ['domcontentloaded', 'load', 'networkidle', 'stable_innerText'];
    const domContentEvent = client.once('Page.domContentEventFired', timeoutMs).catch(() => undefined);
    const loadEvent = client.once('Page.loadEventFired', timeoutMs).catch(() => undefined);
    await client.send('Page.navigate', { url }, timeoutMs);
    await domContentEvent;
    await loadEvent;
    await waitForNetworkQuiet(activeRequests, () => lastNetworkChange, 600, Math.min(timeoutMs, 8_000));
    const snapshot = await waitForStableDom(client, timeoutMs);
    const finalUrl = await currentUrl(client, responseUrl);

    return {
      url: finalUrl,
      status,
      readyState: snapshot.readyState,
      bodyText: snapshot.bodyText,
      headingCount: snapshot.headingCount,
      paragraphCount: snapshot.paragraphCount,
      linkCount: snapshot.linkCount,
      html: snapshot.html,
      waitStrategy,
    };
  } finally {
    client?.close();
    if (chrome && !chrome.killed) chrome.kill();
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function findBrowserExecutable(): string | null {
  const configured = config.crawl.browserPath.trim();
  if (configured && existsSync(configured)) return configured;

  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
      : [
          '/usr/bin/google-chrome',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
          '/usr/bin/microsoft-edge',
        ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function waitForDevToolsPort(userDataDir: string, chrome: ChildProcess, timeoutMs: number): Promise<number> {
  const file = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  let stderr = '';
  chrome.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
    if (stderr.length > 2000) stderr = stderr.slice(-2000);
  });
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null) {
      const detail = stderr.trim() ? ` stderr=${stderr.trim().slice(-1000)}` : '';
      throw new Error(`Chrome exited before DevTools was ready (code ${chrome.exitCode}).${detail}`);
    }
    try {
      const raw = await readFile(file, 'utf8');
      const port = Number(raw.split(/\r?\n/)[0]);
      if (Number.isFinite(port) && port > 0) return port;
    } catch {
      /* not ready */
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for Chrome DevToolsActivePort.');
}

async function createTarget(port: number, timeoutMs: number): Promise<{ webSocketDebuggerUrl: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Chrome target creation failed with HTTP ${res.status}.`);
  const json = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('Chrome target did not return webSocketDebuggerUrl.');
  return { webSocketDebuggerUrl: json.webSocketDebuggerUrl };
}

async function waitForNetworkQuiet(
  activeRequests: Set<string>,
  lastChange: () => number,
  quietMs: number,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (activeRequests.size === 0 && Date.now() - lastChange() >= quietMs) return;
    await delay(100);
  }
}

async function waitForStableDom(client: CdpClient, timeoutMs: number): Promise<DomSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let lastLength = -1;
  let stableCount = 0;
  let latest = await readDomSnapshot(client);

  while (Date.now() < deadline) {
    latest = await readDomSnapshot(client);
    const length = latest.bodyText.length;
    if (length >= 50 && length === lastLength && latest.readyState === 'complete') {
      stableCount += 1;
      if (stableCount >= 2) return latest;
    } else {
      stableCount = 0;
      lastLength = length;
    }
    await delay(300);
  }

  return latest;
}

async function readDomSnapshot(client: CdpClient): Promise<DomSnapshot> {
  const expression = `(() => {
    const body = document.body;
    const bodyText = body && body.innerText ? body.innerText : '';
    return {
      readyState: document.readyState,
      bodyText,
      headingCount: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length,
      paragraphCount: document.querySelectorAll('p').length,
      linkCount: document.querySelectorAll('a[href]').length,
      html: document.documentElement ? document.documentElement.outerHTML : ''
    };
  })()`;

  const result = await client.send<{ result?: { value?: DomSnapshot } }>('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  return result.result?.value ?? {
    readyState: 'unknown',
    bodyText: '',
    headingCount: 0,
    paragraphCount: 0,
    linkCount: 0,
    html: '',
  };
}

async function currentUrl(client: CdpClient, fallback: string): Promise<string> {
  try {
    const result = await client.send<{ result?: { value?: string } }>('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true,
    });
    return result.result?.value ?? fallback;
  } catch {
    return fallback;
  }
}