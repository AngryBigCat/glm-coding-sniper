import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 提取 JS 中的关键 API 路径
const jsUrl = 'https://bigmodel.cn/js/vendors~ClaudeCode~SubscribePay~subscribe-overview.97f659be.js';

const resp = await page.evaluate(async (url) => {
  const r = await fetch(url);
  return r.ok ? await r.text() : null;
}, jsUrl);

if (!resp) { console.log('Failed to fetch JS'); await browser.close(); process.exit(1); }

console.log('=== Full JS content length:', resp.length, '===\n');

// 搜索所有 /api/biz/ 路径
console.log('=== All /api/biz/ paths ===');
const apiPaths = [...resp.matchAll(/["'](\/api\/biz\/[^"']+)["']/g)];
for (const m of apiPaths) console.log(`  ${m[1]}`);

// 搜索 subscribe/create/createSubscri/subscribePay
for (const kw of ['subscribe', 'SubscribePay', 'createSubscri', 'subscri', 'codingPlan']) {
  const idx = resp.indexOf(kw);
  if (idx >= 0) {
    console.log(`\n🎯 "${kw}" at position ${idx}`);
    console.log(`  ...${resp.slice(Math.max(0, idx - 100), idx + 500)}...`);
  }
}

// 搜索 pay/checkout/order 相关的完整函数
const payIdx = resp.indexOf('payOrderNo');
if (payIdx >= 0) {
  console.log('\n\n=== payOrderNo context ===');
  console.log(resp.slice(Math.max(0, payIdx - 200), payIdx + 1000));
}

// 搜索 function 定义
const funcMatch = resp.match(/function\s+\w+\([^)]*\)\s*\{[^}]*subscribe[^}]*\}/);
if (funcMatch) {
  console.log('\n\n=== Subscribe function ===');
  console.log(funcMatch[0]);
}

// 搜索 POST 请求
const postMatch = [...resp.matchAll(/method\s*:\s*["'](post|POST)["']/g)];
console.log('\n\n=== POST methods ===');
for (const m of postMatch) {
  const start = Math.max(0, m.index - 300);
  console.log(`  ...${resp.slice(start, m.index + 100)}...`);
  console.log('  ---');
}

await browser.close();
