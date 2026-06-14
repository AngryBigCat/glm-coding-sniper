#!/usr/bin/env node
/**
 * 首次安装引导 — 检查并创建 config.ts
 *
 * 用法: npm run setup
 *
 * 逻辑：
 *   - config.ts 不存在 → 从 config.example.ts 复制 → 提示填 token
 *   - 已存在 → 提示已配置，不覆盖（保护用户已有配置）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename: string = fileURLToPath(import.meta.url);
const __dirname: string = path.dirname(__filename);
const ROOT: string = path.join(__dirname, '..');

const CONFIG_PATH: string = path.join(ROOT, 'config.ts');
const EXAMPLE_PATH: string = path.join(ROOT, 'config.example.ts');

console.log('='.repeat(50));
console.log('🔧 GLM Coding Sniper 安装引导');
console.log('='.repeat(50));
console.log('');

// 1. 检查 config 是否已存在
if (fs.existsSync(CONFIG_PATH)) {
  console.log('✅ config.ts 已存在，跳过创建（不覆盖已有配置）');
  console.log('');
  console.log('如需重新配置，请手动编辑：');
  console.log(`   ${CONFIG_PATH}`);
  console.log('');
  console.log('或删除后重新运行 npm run setup');
  process.exit(0);
}

// 2. 检查模板是否存在
if (!fs.existsSync(EXAMPLE_PATH)) {
  console.log('❌ 找不到 config.example.ts 模板文件');
  console.log(`   期望路径: ${EXAMPLE_PATH}`);
  console.log('   请从 git 仓库恢复该文件');
  process.exit(1);
}

// 3. 复制模板
fs.copyFileSync(EXAMPLE_PATH, CONFIG_PATH);
console.log('✅ 已创建 config.ts（从 config.example.ts 复制）');
console.log('');
console.log('─'.repeat(50));
console.log('📌 接下来请编辑配置文件，填入真实凭证：');
console.log('');
console.log(`   ${CONFIG_PATH}`);
console.log('');
console.log('需要填写的字段：');
console.log('   AUTH_TOKEN   — 从 bigmodel.cn 浏览器 Cookie 获取');
console.log('   CUSTOMER_ID  — 从 bigmodel.cn 个人中心获取');
console.log('');
console.log('获取 AUTH_TOKEN 的方法：');
console.log('   1. 浏览器打开 https://www.bigmodel.cn/glm-coding 并登录');
console.log('   2. 按 F12 → Console，运行：');
console.log('      document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]');
console.log('   3. 复制输出填到 config.ts');
console.log('');
console.log('填完后运行 npm run test:connect 验证连通性');
console.log('─'.repeat(50));
