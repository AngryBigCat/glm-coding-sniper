/**
 * HTTP 客户端 + 日志工具 — 基础设施层
 *
 * 依赖方向：被 api.ts / main.ts 引用
 * 自身依赖：constants.js（STATIC_HEADERS）
 *
 * 设计：api 函数通过 createApiClient(token) 工厂创建，
 *       绑定 authToken，避免底层模块直接 import config。
 *       日志工具（ts/log/setLogSink）不依赖 token，保持直接导出。
 */

import https from 'node:https';
import { STATIC_HEADERS } from './constants.js';
import type { ApiResponse, ApiParseError } from './types.js';

// ===== 日志工具（不依赖 token，全局可用）=====
export function ts(): string {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

// 日志 sink：注入后每次 log() 调用会同时转发到浏览器监控面板
let logSink: ((msg: string) => void) | null = null;

export function setLogSink(fn: ((msg: string) => void) | null): void {
  logSink = fn;
}

export function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
  logSink?.(msg);
}

// ===== 请求客户端类型 =====
/** 绑定了 authToken 的请求函数 */
export type ApiClient = <T = ApiResponse>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown> | null,
) => Promise<T | ApiParseError>;

/**
 * 创建绑定 authToken 的 API 客户端
 * 在 main.ts 调用一次，返回的 client 注入给业务层
 */
export function createApiClient(authToken: string): ApiClient {
  const baseHeaders: Record<string, string> = {
    ...STATIC_HEADERS,
    authorization: authToken,
  };

  return function api<T = ApiResponse>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | null = null,
  ): Promise<T | ApiParseError> {
    return new Promise((resolve, reject) => {
      const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
      const h = { ...baseHeaders };
      let bs: string | null = null;
      if (body) {
        bs = JSON.stringify(body);
        h['content-type'] = 'application/json;charset=UTF-8';
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
  };
}
