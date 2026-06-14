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
import type { ServerState, Phase, TicketCred, StatusResponse, PushResponse } from '../core/types.js';

export const PORT = 3737;

// ===== 共享状态 =====
export const state: ServerState = {
  pool: [],
  phase: 'idle',
  message: '等待启动',
  totalProduced: 0,
  totalConsumed: 0,
  startedAt: null,
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

    // GET /status — 浏览器查询抢购状态
    if (req.method === 'GET' && url.pathname === '/status') {
      const resp: StatusResponse = {
        phase: state.phase,
        message: state.message,
        poolSize: state.pool.length,
        totalProduced: state.totalProduced,
        totalConsumed: state.totalConsumed,
        startedAt: state.startedAt,
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
