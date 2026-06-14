/**
 * ticket-server.mjs — ticket 生产者-消费者桥接服务
 *
 * 职责：
 *   1. 起本地 HTTP 服务接收浏览器推送的 ticket
 *   2. 维护共享 ticket 池
 *   3. 暴露抢购状态给浏览器（让出码页知道何时停止）
 *
 * 接口：
 *   POST /push      { ticket, randstr }          → 入池
 *   GET  /status    { phase, poolSize, message } → 浏览器轮询抢购进度
 *   GET  /pull                                  → 主脚本拉一个 ticket 出池（备用）
 */

import http from 'http';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PORT = 3737;

// ===== 共享状态 =====
export const state = {
  pool: [],            // ticket 池：[{ ticket, randstr, ts }]
  phase: 'idle',       // idle | collecting | sniping | done | failed
  message: '等待启动',
  totalProduced: 0,    // 累计生产数
  totalConsumed: 0,    // 累计消费数
  startedAt: null,
};

function now() { return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }); }

// ===== 池操作 =====
export function pushTicket(ticket, randstr) {
  state.pool.push({ ticket, randstr, ts: Date.now() });
  state.totalProduced++;
  return state.pool.length;
}

export function shiftTicket() {
  const t = state.pool.shift();
  if (t) state.totalConsumed++;
  return t;
}

export function poolSize() { return state.pool.length; }

export function setPhase(phase, message = '') {
  state.phase = phase;
  if (message) state.message = message;
}

// ===== HTTP 服务 =====
function readBody(req) {
  return new Promise((resolve) => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => {
      try { resolve(JSON.parse(d || '{}')); }
      catch { resolve({}); }
    });
  });
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    // CORS：允许浏览器跨域访问
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // POST /push — 浏览器推送 ticket
    if (req.method === 'POST' && url.pathname === '/push') {
      const { ticket, randstr } = await readBody(req);
      if (!ticket || !randstr) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing ticket/randstr' }));
        return;
      }
      const size = pushTicket(ticket, randstr);
      console.log(`[${now()}] 📥 收到 ticket #${state.totalProduced}，池子 ${size} 个`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, poolSize: size, phase: state.phase }));
      return;
    }

    // GET /status — 浏览器查询抢购状态
    if (req.method === 'GET' && url.pathname === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        phase: state.phase,
        message: state.message,
        poolSize: state.pool.length,
        totalProduced: state.totalProduced,
        totalConsumed: state.totalConsumed,
        startedAt: state.startedAt,
      }));
      return;
    }

    // GET /pull — 主脚本拉 ticket（备用接口，一般直接用内存）
    if (req.method === 'GET' && url.pathname === '/pull') {
      const t = shiftTicket();
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: !!t, ticket: t }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(PORT, () => {
    state.startedAt = Date.now();
    console.log(`[${now()}] 🌐 ticket 服务已启动: http://localhost:${PORT}`);
  });

  return server;
}

// ===== 启动浏览器打开 captcha-helper.html =====
export function openBrowser() {
  const htmlPath = path.join(__dirname, 'captcha-helper.html');
  // Windows: start 命令用默认浏览器打开
  // Mac: open，Linux: xdg-open
  const cmd = process.platform === 'win32'
    ? `start "" "${htmlPath}"`
    : process.platform === 'darwin'
      ? `open "${htmlPath}"`
      : `xdg-open "${htmlPath}"`;

  exec(cmd, (err) => {
    if (err) {
      console.log(`[${now()}] ⚠️  自动打开浏览器失败，请手动双击 captcha-helper.html`);
      console.log(`       路径: ${htmlPath}`);
    } else {
      console.log(`[${now()}] 🚀 已自动打开浏览器，请开始拖滑块`);
    }
  });
}
