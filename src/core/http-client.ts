/**
 * HTTP 客户端 + 日志工具 — 基础设施层
 *
 * 依赖方向：被 api.ts / sniper.ts 引用
 * 自身依赖：constants.js（HEADERS）
 */

import https from 'node:https';
import { HEADERS } from './constants.js';
import type { ApiResponse, ApiParseError } from './types.js';

// ===== 日志工具 =====
export function ts(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 日志 sink：注入后每次 log() 调用会同时转发到浏览器监控面板
// 用回调注入而非直接 import server，保持 core → server 的单向依赖
let logSink: ((msg: string) => void) | null = null;

export function setLogSink(fn: ((msg: string) => void) | null): void {
  logSink = fn;
}

export function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
  logSink?.(msg); // 只传 msg（不含时间前缀），前端自己格式化时间
}

// ===== 请求封装 =====
/**
 * 泛型 api：T 是期望的响应类型（通常继承 ApiResponse）
 * 失败时返回 ApiParseError（不 reject），业务层用 'parseError' in r 判别
 */
export function api<T = ApiResponse>(
  method: 'GET' | 'POST',
  path: string,
  body: Record<string, unknown> | null = null,
): Promise<T | ApiParseError> {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
    const h = { ...HEADERS };
    let bs: string | null = null;
    if (body) {
      bs = JSON.stringify(body);
      h['content-type'] = 'application/json';
      h['content-length'] = Buffer.byteLength(bs).toString();
    }
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers: h, timeout: 15000 },
      (res) => {
        let d = '';
        res.on('data', (c: Buffer) => (d += c.toString()));
        res.on('end', () => {
          try {
            resolve(JSON.parse(d) as T);
          } catch {
            resolve({ parseError: true, raw: d.slice(0, 300) });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (bs) req.write(bs);
    req.end();
  });
}
