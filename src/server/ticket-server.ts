/**
 * ticket-server.ts — ticket 生产者-消费者桥接服务
 *
 * 职责：
 *   1. 起本地 HTTP 服务接收浏览器推送的 ticket
 *   2. 维护共享 ticket 池
 *   3. 暴露抢购状态给浏览器（让出码页知道何时停止）
 *   4. GET / 直接返回验证码页面（集成 captcha.html）
 *
 * 接口：
 *   GET  /          → 返回验证码页面 HTML
 *   POST /push      { ticket, randstr }          → 入池
 *   GET  /status    { phase, poolSize, message } → 浏览器轮询抢购进度
 *   GET  /pull                                  → 主脚本拉一个 ticket 出池（备用）
 */

import http from 'node:http';
import { exec } from 'node:child_process';
import { renderPage } from '../pages/captcha.js';
import type {
  ServerState,
  Phase,
  TicketCred,
  StatusResponse,
  PushResponse,
  StockProduct,
  StockSnapshotItem,
  LogEntry,
  OrderRecord,
  OrderResult,
} from '../core/types.js';

export const PORT = 3737;

/** 日志环形缓冲最大条数 */
const MAX_LOGS = 30;

// ===== 共享状态 =====
export const state: ServerState = {
  pool: [],
  phase: 'idle',
  message: '等待启动',
  totalProduced: 0,
  totalConsumed: 0,
  startedAt: null,
  // 监控面板数据
  lastStock: [],
  logs: [],
  lastOrder: null,
  checkCount: 0,
};

function now(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// ===== 池操作 =====
export function pushTicket(ticket: string, randstr: string): number {
  state.pool.push({ ticket, randstr, ts: Date.now() });
  state.totalProduced++;
  return state.pool.length;
}

export function shiftTicket(): TicketCred | undefined {
  const t = state.pool.shift();
  if (t) state.totalConsumed++;
  return t;
}

export function poolSize(): number {
  return state.pool.length;
}

export function setPhase(phase: Phase, message: string = ''): void {
  state.phase = phase;
  if (message) state.message = message;
}

// ===== 抢购暂停/继续（被浏览器按钮控制）=====
let paused = false;

export function isPaused(): boolean {
  return paused;
}

export function setPaused(p: boolean): void {
  paused = p;
  if (p) {
    state.phase = 'paused';
    state.message = '已暂停';
  } else {
    state.phase = 'sniping';
    state.message = '已继续';
  }
}

// ===== 监控面板 setter（被 main.ts 调用）=====

/** 更新库存快照（把 StockProduct 转成精简的展示数据） */
export function setLastStock(products: StockProduct[], count: number): void {
  state.lastStock = products.map((p) => {
    let status: StockSnapshotItem['status'];
    if (!p.apiData) status = 'unknown';
    else if (p.apiData.soldOut) status = 'yellow';
    else if (p.apiData.forbidden) status = 'red';
    else status = 'green';
    return { name: p.name, status };
  });
  state.checkCount = count;
}

/** 追加一条日志（环形缓冲，超过 MAX_LOGS 丢弃最早的） */
export function appendLog(text: string): void {
  const entry: LogEntry = { ts: Date.now(), text };
  state.logs.push(entry);
  if (state.logs.length > MAX_LOGS) state.logs.shift();
}

/** 记录最近一次下单结果 */
export function recordOrder(result: OrderResult): void {
  if ('success' in result) {
    const rec: OrderRecord = {
      ok: true,
      productName: result.productName,
      payAmount: result.payAmount,
      sign: result.data.sign,
      ts: Date.now(),
    };
    state.lastOrder = rec;
  } else {
    state.lastOrder = { ok: false, error: result.error, ts: Date.now() };
  }
}

// ===== HTTP 服务 =====
function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', (c: Buffer) => (d += c.toString()));
    req.on('end', () => {
      try {
        resolve(JSON.parse(d || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS：允许浏览器跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // GET / — 返回验证码页面 HTML
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(renderPage());
      return;
    }

    // POST /push — 浏览器推送 ticket
    if (req.method === 'POST' && url.pathname === '/push') {
      const body = await readBody(req);
      const ticket = body.ticket as string | undefined;
      const randstr = body.randstr as string | undefined;
      if (!ticket || !randstr) {
        const resp: PushResponse = { ok: false, error: 'missing ticket/randstr' };
        sendJson(res, 400, resp);
        return;
      }
      const size = pushTicket(ticket, randstr);
      console.log(`[${now()}] 📥 收到 ticket #${state.totalProduced}，池子 ${size} 个`);
      const resp: PushResponse = { ok: true, poolSize: size, phase: state.phase };
      sendJson(res, 200, resp);
      return;
    }

    // GET /status — 浏览器查询抢购状态（含监控面板数据）
    if (req.method === 'GET' && url.pathname === '/status') {
      const resp: StatusResponse = {
        phase: state.phase,
        message: state.message,
        poolSize: state.pool.length,
        totalProduced: state.totalProduced,
        totalConsumed: state.totalConsumed,
        startedAt: state.startedAt,
        lastStock: state.lastStock,
        logs: state.logs,
        lastOrder: state.lastOrder,
        checkCount: state.checkCount,
      };
      sendJson(res, 200, resp);
      return;
    }

    // GET /pull — 主脚本拉 ticket（备用接口，一般直接用内存）
    if (req.method === 'GET' && url.pathname === '/pull') {
      const t = shiftTicket();
      sendJson(res, 200, { ok: !!t, ticket: t });
      return;
    }

    // POST /pause — 暂停抢购循环
    if (req.method === 'POST' && url.pathname === '/pause') {
      setPaused(true);
      console.log(`[${now()}] ⏸ 抢购已暂停`);
      sendJson(res, 200, { ok: true, paused: true });
      return;
    }

    // POST /resume — 继续抢购循环
    if (req.method === 'POST' && url.pathname === '/resume') {
      setPaused(false);
      console.log(`[${now()}] ▶️ 抢购已继续`);
      sendJson(res, 200, { ok: true, paused: false });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  });

  server.listen(PORT, () => {
    state.startedAt = Date.now();
    console.log(`[${now()}] 🌐 ticket 服务已启动: http://localhost:${PORT}`);
  });

  return server;
}

// ===== 启动浏览器打开验证码页面（server 直接返回的 http://localhost:PORT/）=====
export function openBrowser(): void {
  const pageUrl = `http://localhost:${PORT}/`;
  // Windows: start 命令用默认浏览器打开
  // Mac: open，Linux: xdg-open
  const cmd =
    process.platform === 'win32'
      ? `start "" "${pageUrl}"`
      : process.platform === 'darwin'
        ? `open "${pageUrl}"`
        : `xdg-open "${pageUrl}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`[${now()}] ⚠️  自动打开浏览器失败，请手动访问：`);
      console.log(`       ${pageUrl}`);
    } else {
      console.log(`[${now()}] 🚀 已自动打开浏览器，请开始拖滑块`);
    }
  });
}
