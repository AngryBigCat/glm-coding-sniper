/**
 * 验证码页面渲染 — 读 public/captcha.html 返回给浏览器
 *
 * 依赖方向：被 server/ticket-server.ts 引用
 * 自身依赖：node:fs / node:path（读取 html 源文件）
 *
 * 设计：启动时读一次缓存，避免每次请求都做文件 IO。
 *       html 里的 fetch 已改用相对路径（同源），无需变量注入。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTML_PATH = path.join(__dirname, '../../public/captcha.html');

// 启动时读一次并缓存
let cachedPage: string | null = null;

export function renderPage(): string {
  if (cachedPage === null) {
    cachedPage = fs.readFileSync(HTML_PATH, 'utf8');
  }
  return cachedPage;
}
