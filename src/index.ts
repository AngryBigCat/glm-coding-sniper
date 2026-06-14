#!/usr/bin/env node
/**
 * GLM Coding Sniper — 应用入口
 *
 * 本文件是 npm start 的入口点（package.json scripts.start 指向这里）。
 * 实际抢购编排逻辑在 src/core/sniper.ts，import 它即触发 main() 执行。
 *
 * 目录结构：
 *   src/
 *   ├── index.ts          ← 入口（本文件）
 *   ├── config.ts         ← 凭据（AUTH_TOKEN / CUSTOMER_ID）
 *   ├── core/             ← 核心业务层
 *   │   ├── types.ts         类型定义
 *   │   ├── constants.ts     常量配置（CONFIG / PRODUCTS / HEADERS）
 *   │   ├── http-client.ts   基础设施（api 请求封装 + 日志）
 *   │   ├── api.ts           业务逻辑（查库存 / 下单）
 *   │   └── sniper.ts        编排层（主循环）
 *   └── server/          ← HTTP 服务层
 *       ├── captcha-page.ts  验证码页面渲染
 *       └── ticket-server.ts ticket 池服务 + 页面路由
 *
 * 依赖方向（严格单向，无循环）：
 *   index → sniper → { api, server/ticket-server }
 *   api → { http-client, constants } → config
 *   server/ticket-server → captcha-page → (fs 读 public/)
 */

import './core/sniper.js';
