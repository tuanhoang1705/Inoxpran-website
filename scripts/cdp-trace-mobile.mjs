#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function parseArgs(argv) {
  const out = {
    url: 'http://localhost:5173/',
    output: path.resolve('tmp/perf', `cdp-mobile-trace-${Date.now()}.json`),
    port: 9222,
    cpu: 4,
    width: 430,
    height: 932,
    dpr: 3,
    mobile: true,
    headless: true,
    waitAfterLoadMs: 2000,
    cacheDisabled: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    lang: 'vi-VN',
    chromePath: null,
    traceCategories: [
      'toplevel',
      'devtools.timeline',
      'blink.user_timing',
      'loading',
      'v8',
      'disabled-by-default-devtools.timeline',
      'disabled-by-default-devtools.timeline.frame',
      'disabled-by-default-devtools.timeline.stack'
    ].join(','),
    networkPreset: 'none',
    quietChrome: true
  };

  const map = new Map();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [key, inlineVal] = token.split('=');
    if (inlineVal !== undefined) {
      map.set(key, inlineVal);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      map.set(key, true);
    } else {
      map.set(key, next);
      i += 1;
    }
  }

  const num = (name, current) => (map.has(name) ? Number(map.get(name)) : current);
  const bool = (name, current) => {
    if (!map.has(name)) return current;
    const value = map.get(name);
    if (value === true) return true;
    if (typeof value !== 'string') return current;
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
  };

  out.url = map.get('--url') || out.url;
  out.output = path.resolve(map.get('--output') || out.output);
  out.port = num('--port', out.port);
  out.cpu = num('--cpu', out.cpu);
  out.width = num('--width', out.width);
  out.height = num('--height', out.height);
  out.dpr = num('--dpr', out.dpr);
  out.waitAfterLoadMs = num('--wait-after-load', out.waitAfterLoadMs);
  out.mobile = bool('--mobile', out.mobile);
  out.headless = bool('--headless', out.headless);
  out.cacheDisabled = bool('--cache-disabled', out.cacheDisabled);
  out.lang = map.get('--lang') || out.lang;
  out.chromePath = map.get('--chrome') || out.chromePath;
  out.traceCategories = map.get('--categories') || out.traceCategories;
  out.networkPreset = map.get('--network') || out.networkPreset;
  out.quietChrome = bool('--quiet-chrome', out.quietChrome);

  if (map.has('--help')) out.help = true;
  return out;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/cdp-trace-mobile.mjs [options]

Options:
  --url <url>                 URL cần trace (default: http://localhost:5173/)
  --output <file>             File trace JSON output
  --cpu <rate>                CPU throttling rate (default: 4)
  --network <preset>          none | fast3g | slow4g (default: none)
  --width <px>                Viewport width (default: 430)
  --height <px>               Viewport height (default: 932)
  --dpr <n>                   Device pixel ratio (default: 3)
  --wait-after-load <ms>      Chờ thêm sau loadEventFired (default: 2000)
  --chrome <path>             Đường dẫn chrome.exe / msedge.exe
  --headless <true|false>     Chạy headless (default: true)
  --cache-disabled <bool>     Tắt HTTP cache khi trace (default: true)

Ví dụ:
  node scripts/cdp-trace-mobile.mjs --url http://localhost:5173/ --cpu 6 --network slow4g
`);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function detectChromePath(explicitPath) {
  if (explicitPath) return explicitPath;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

async function waitForHttpJson(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw new Error(`Timeout waiting for ${url}: ${lastError?.message || 'unknown error'}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    this.closed = false;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = (ev) => reject(new Error(`WebSocket error: ${ev?.message || 'unknown'}`));
      ws.onclose = () => {
        this.closed = true;
        for (const [, item] of this.pending) {
          item.reject(new Error('CDP socket closed'));
        }
        this.pending.clear();
      };
      ws.onmessage = (event) => this.#onMessage(event.data);
    });
  }

  #onMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(`${message.error.message || 'CDP error'} (${message.error.code ?? ''})`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method) {
      const list = this.handlers.get(message.method);
      if (!list) return;
      for (const fn of [...list]) {
        try {
          fn(message.params ?? {});
        } catch {
          // ignore handler errors to avoid breaking the session
        }
      }
    }
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  waitFor(method, predicate = () => true, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timeout waiting for ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params) => {
        if (!predicate(params)) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  send(method, params = {}) {
    if (this.closed || !this.ws) return Promise.reject(new Error('CDP socket is not connected'));
    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
    });
  }

  close() {
    if (!this.ws || this.closed) return;
    this.ws.close();
  }
}

function buildChromeArgs(config, userDataDir) {
  const args = [
    `--remote-debugging-port=${config.port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--metrics-recording-only',
    '--disable-extensions',
    '--mute-audio',
    '--window-position=0,0',
    `--window-size=${Math.max(320, Math.round(config.width))},${Math.max(480, Math.round(config.height))}`,
    '--disable-features=CalculateNativeWinOcclusion'
  ];
  if (config.headless) {
    args.push('--headless=new', '--disable-gpu');
  }
  args.push('about:blank');
  return args;
}

function getNetworkProfile(preset) {
  const p = String(preset || 'none').toLowerCase();
  if (p === 'none') return null;
  if (p === 'fast3g') {
    return {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
      connectionType: 'cellular3g'
    };
  }
  if (p === 'slow4g') {
    return {
      offline: false,
      latency: 80,
      downloadThroughput: (4 * 1024 * 1024) / 8,
      uploadThroughput: (3 * 1024 * 1024) / 8,
      connectionType: 'cellular4g'
    };
  }
  throw new Error(`Unsupported network preset: ${preset}`);
}

async function launchChrome(config) {
  const chromePath = detectChromePath(config.chromePath);
  if (!chromePath) {
    throw new Error('Không tìm thấy Chrome/Edge. Dùng --chrome <path> để chỉ định.');
  }

  const userDataDir = path.join(os.tmpdir(), `inoxpran-cdp-trace-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = buildChromeArgs(config, userDataDir);
  const child = spawn(chromePath, args, {
    stdio: config.quietChrome ? 'ignore' : 'inherit',
    windowsHide: true
  });

  child.on('exit', () => {
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  const version = await waitForHttpJson(`http://127.0.0.1:${config.port}/json/version`, 10000);
  return { child, chromePath, wsBrowser: version.webSocketDebuggerUrl };
}

async function getPageTargetWs(config) {
  const targets = await waitForHttpJson(`http://127.0.0.1:${config.port}/json/list`, 5000);
  const page = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!page?.webSocketDebuggerUrl) {
    throw new Error('Không lấy được WebSocket debugger URL cho page target');
  }
  return page.webSocketDebuggerUrl;
}

async function readCdpStream(client, stream, outputFile) {
  await fsp.mkdir(path.dirname(outputFile), { recursive: true });
  const fd = await fsp.open(outputFile, 'w');
  try {
    while (true) {
      const chunk = await client.send('IO.read', { handle: stream, size: 1024 * 1024 });
      const data = chunk.base64Encoded
        ? Buffer.from(chunk.data || '', 'base64')
        : Buffer.from(chunk.data || '', 'utf8');
      if (data.length) {
        await fd.write(data);
      }
      if (chunk.eof) break;
    }
  } finally {
    await fd.close();
    try {
      await client.send('IO.close', { handle: stream });
    } catch {
      // ignore
    }
  }
}

function pickTargetRendererMain(events) {
  const procNames = new Map();
  const threadNames = new Map();
  const byThread = new Map();

  for (const e of events) {
    const key = `${e.pid}:${e.tid}`;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key).push(e);
    if (e.ph === 'M' && e.name === 'process_name') procNames.set(String(e.pid), e.args?.name || '');
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(key, e.args?.name || '');
  }
  for (const arr of byThread.values()) arr.sort((a, b) => (a.ts || 0) - (b.ts || 0));

  let best = null;
  for (const [key, name] of threadNames.entries()) {
    if (!/CrRendererMain|RendererMain/i.test(name)) continue;
    const arr = byThread.get(key) || [];
    const hasFcp = arr.some((e) => e.name === 'firstContentfulPaint');
    const layoutDur = arr
      .filter((e) => e.ph === 'X' && e.name === 'Layout' && Number.isFinite(e.dur))
      .reduce((sum, e) => sum + e.dur, 0);
    const score = (hasFcp ? 1e12 : 0) + layoutDur;
    if (!best || score > best.score) {
      best = {
        key,
        name,
        process: procNames.get(String(arr[0]?.pid ?? '')) || '',
        arr,
        score
      };
    }
  }
  return best;
}

function findNavStart(arr) {
  const nav = arr.find((e) => e.name === 'navigationStart' && Number.isFinite(e.ts));
  if (nav) return nav.ts;
  const req = arr.find(
    (e) =>
      e.name === 'ResourceSendRequest' &&
      Number.isFinite(e.ts) &&
      typeof e.args?.data?.url === 'string' &&
      e.args.data.url.startsWith('http')
  );
  return req?.ts ?? arr.find((e) => Number.isFinite(e.ts))?.ts ?? 0;
}

function usToMs(us) {
  return us / 1000;
}

function fmtMs(us) {
  return `${usToMs(us).toFixed(1)}ms`;
}

function parseTraceSummary(traceFile) {
  const trace = JSON.parse(fs.readFileSync(traceFile, 'utf8'));
  const events = Array.isArray(trace) ? trace : (trace.traceEvents || []);
  const target = pickTargetRendererMain(events);
  if (!target) {
    return { error: 'Không tìm thấy renderer main thread trong trace' };
  }
  const arr = target.arr;
  const navStart = findNavStart(arr);
  const xEvents = arr.filter((e) => e.ph === 'X' && Number.isFinite(e.ts) && Number.isFinite(e.dur));
  const taskName = xEvents.some((e) => e.name === 'RunTask') ? 'RunTask' : 'ThreadControllerImpl::RunTask';
  const tasks = xEvents.filter((e) => e.name === taskName);
  const longTasks = tasks.filter((e) => e.dur >= 50000).sort((a, b) => b.dur - a.dur);

  const evalNames = new Set(['EvaluateScript', 'FunctionCall', 'v8.callFunction', 'v8.evaluateModule']);
  const jsByUrl = new Map();
  for (const e of xEvents) {
    if (!evalNames.has(e.name)) continue;
    const data = e.args?.data || {};
    const url = data.url || data.scriptName || data.fileName || data.sourceURL || '(inline/unknown)';
    jsByUrl.set(url, (jsByUrl.get(url) || 0) + e.dur);
  }

  const starts = xEvents.map((e) => e.ts);
  const lb = (ts) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < ts) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

  const longTaskDetails = longTasks.slice(0, 10).map((task) => {
    const start = task.ts;
    const end = task.ts + task.dur;
    const totals = new Map();
    const js = [];
    for (let i = lb(start); i < xEvents.length; i++) {
      const e = xEvents[i];
      if (e.ts >= end) break;
      if (e === task) continue;
      const d = overlap(start, end, e.ts, e.ts + e.dur);
      if (!d) continue;
      totals.set(e.name, (totals.get(e.name) || 0) + d);
      if (evalNames.has(e.name)) {
        const data = e.args?.data || {};
        const url = data.url || data.scriptName || data.fileName || data.sourceURL || '(inline/unknown)';
        js.push({ name: e.name, url, dur: d });
      }
    }
    return {
      dur: task.dur,
      offset: task.ts - navStart,
      topNested: [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      topJs: js.sort((a, b) => b.dur - a.dur).slice(0, 5)
    };
  });

  const milestoneNames = [
    'domContentLoadedEventEnd',
    'firstPaint',
    'firstContentfulPaint',
    'loadEventEnd',
    'largestContentfulPaint::Candidate'
  ];
  const milestones = {};
  for (const name of milestoneNames) {
    const matches = arr.filter((e) => e.name === name && Number.isFinite(e.ts));
    if (!matches.length) continue;
    if (name === 'largestContentfulPaint::Candidate') {
      milestones.LCP = matches[matches.length - 1].ts - navStart;
    } else {
      milestones[name] = matches[matches.length - 1].ts - navStart;
    }
  }

  return {
    rendererThread: target.key,
    taskEventName: taskName,
    longTaskCount: longTasks.length,
    totalLongTaskUs: longTasks.reduce((sum, e) => sum + e.dur, 0),
    milestones,
    topJsByUrl: [...jsByUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
    longTaskDetails
  };
}

function printSummary(summary) {
  if (summary.error) {
    console.log(`\n[trace summary] ${summary.error}`);
    return;
  }
  console.log('\n=== CDP Trace Summary (target renderer main thread) ===');
  console.log(`renderer thread: ${summary.rendererThread}`);
  console.log(`task event: ${summary.taskEventName}`);
  console.log(`long tasks > 50ms: ${summary.longTaskCount}`);
  console.log(`total long-task time: ${fmtMs(summary.totalLongTaskUs)}`);
  if (summary.milestones.domContentLoadedEventEnd != null) {
    console.log(`DOMContentLoaded: ${fmtMs(summary.milestones.domContentLoadedEventEnd)}`);
  }
  if (summary.milestones.firstContentfulPaint != null) {
    console.log(`FCP: ${fmtMs(summary.milestones.firstContentfulPaint)}`);
  }
  if (summary.milestones.LCP != null) {
    console.log(`LCP candidate: ${fmtMs(summary.milestones.LCP)}`);
  }
  if (summary.milestones.loadEventEnd != null) {
    console.log(`loadEventEnd: ${fmtMs(summary.milestones.loadEventEnd)}`);
  }

  console.log('\nTop JS/script work (sum on main thread):');
  for (const [url, dur] of summary.topJsByUrl) {
    console.log(`  - ${fmtMs(dur)} :: ${url}`);
  }

  if (!summary.longTaskDetails.length) return;
  console.log('\nTop long tasks:');
  for (const task of summary.longTaskDetails) {
    console.log(`  - ${fmtMs(task.dur)} at +${fmtMs(task.offset)}`);
    for (const [name, dur] of task.topNested) {
      console.log(`      * ${name}: ${fmtMs(dur)}`);
    }
    for (const js of task.topJs) {
      console.log(`      * ${js.name} ${fmtMs(js.dur)} :: ${js.url}`);
    }
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  ensureDir(config.output);

  let chrome = null;
  let client = null;
  try {
    console.log(`[cdp-trace] URL: ${config.url}`);
    console.log(
      `[cdp-trace] Emulation: ${config.width}x${config.height} @${config.dpr}, cpu x${config.cpu}, network=${config.networkPreset}`
    );
    console.log(`[cdp-trace] Output: ${config.output}`);

    chrome = await launchChrome(config);
    const pageWs = await getPageTargetWs(config);
    client = new CDPClient(pageWs);
    await client.connect();

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Network.enable');
    await client.send('Performance.enable');
    await client.send('Page.setLifecycleEventsEnabled', { enabled: true });

    if (config.cacheDisabled) {
      await client.send('Network.setCacheDisabled', { cacheDisabled: true });
    }

    if (config.mobile) {
      await client.send('Emulation.setDeviceMetricsOverride', {
        width: Math.round(config.width),
        height: Math.round(config.height),
        deviceScaleFactor: config.dpr,
        mobile: true,
        screenWidth: Math.round(config.width),
        screenHeight: Math.round(config.height),
        dontSetVisibleSize: false
      });
      await client.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5
      });
      await client.send('Emulation.setUserAgentOverride', {
        userAgent: config.userAgent,
        platform: 'iPhone',
        acceptLanguage: config.lang
      });
    }

    if (config.cpu > 1) {
      await client.send('Emulation.setCPUThrottlingRate', { rate: config.cpu });
    }

    const network = getNetworkProfile(config.networkPreset);
    if (network) {
      await client.send('Network.emulateNetworkConditions', network);
    }

    const loadFired = client.waitFor('Page.loadEventFired', () => true, 30000);
    const traceComplete = client.waitFor('Tracing.tracingComplete', () => true, 120000);

    await client.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      categories: config.traceCategories,
      options: 'record-as-much-as-possible'
    });

    await client.send('Page.navigate', { url: config.url });

    await loadFired;

    let networkIdleHit = false;
    try {
      await client.waitFor(
        'Page.lifecycleEvent',
        (evt) =>
          ['networkIdle', 'networkAlmostIdle'].includes(evt.name) &&
          evt.frameId &&
          typeof evt.loaderId === 'string',
        Math.min(8000, Math.max(1500, config.waitAfterLoadMs + 1000))
      );
      networkIdleHit = true;
    } catch {
      // fallback to fixed wait below
    }

    if (config.waitAfterLoadMs > 0) {
      await delay(config.waitAfterLoadMs);
    }

    const perfMetrics = await client.send('Performance.getMetrics').catch(() => ({ metrics: [] }));
    await client.send('Tracing.end');
    const tracingDone = await traceComplete;

    if (!tracingDone.stream) {
      throw new Error('Tracing complete nhưng không có stream handle');
    }

    await readCdpStream(client, tracingDone.stream, config.output);
    const stat = await fsp.stat(config.output);

    console.log(`[cdp-trace] loadEventFired: ok${networkIdleHit ? ' (networkIdle seen)' : ''}`);
    console.log(`[cdp-trace] Trace saved: ${config.output} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);

    if (Array.isArray(perfMetrics.metrics) && perfMetrics.metrics.length) {
      const want = new Set(['DomContentLoaded', 'FirstMeaningfulPaint', 'FirstContentfulPaint', 'TaskDuration']);
      const metricsMap = new Map(perfMetrics.metrics.map((m) => [m.name, m.value]));
      const selected = [...want].filter((n) => metricsMap.has(n));
      if (selected.length) {
        console.log('[cdp-trace] Performance.getMetrics:');
        for (const name of selected) {
          console.log(`  - ${name}: ${metricsMap.get(name)}`);
        }
      }
    }

    try {
      const summary = parseTraceSummary(config.output);
      printSummary(summary);
    } catch (error) {
      console.log(`[cdp-trace] Không parse được trace summary: ${error.message}`);
    }
  } finally {
    if (client) client.close();
    if (chrome?.child && !chrome.child.killed) {
      chrome.child.kill();
      try {
        await Promise.race([
          new Promise((resolve) => chrome.child.once('exit', resolve)),
          delay(2000)
        ]);
      } catch {
        // ignore
      }
      if (!chrome.child.killed) {
        try {
          chrome.child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(`\n[cdp-trace] ERROR: ${error.message}`);
  process.exitCode = 1;
});

