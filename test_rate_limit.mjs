#!/usr/bin/env node
/**
 * 限流压力测试 — 用 batch-preview（不费 ticket）探测服务器限流阈值
 *
 * 目的: 在你投入真 ticket 之前，先搞清楚服务器什么节奏会 555
 *
 * 用法: node test_rate_limit.mjs
 *
 * 输出示例:
 *   📊 测试结果:
 *   单发模式: 555 0% (0/20)  平均延迟 320ms ✅ 安全
 *   并发 5个: 555 20% (3/15) 平均延迟 480ms ⚠️ 谨慎
 *   并发 3个间隔300ms: 0%     ✅ 推荐参数
 */

import https from 'https';
import http from 'http';
import { AUTH_TOKEN } from './config.mjs';

// ===== 配置（临时测试用） =====
const TEST_PROXIES = null; // 同 v2，测试代理轮换效果
// const TEST_PROXIES = ['http://127.0.0.1:7890'];

const PRODUCTS = {
  lite: { id: 'product-02434c', name: 'Lite' },
  pro:  { id: 'product-1df3e1', name: 'Pro' },
  max:  { id: 'product-2fc421', name: 'Max' },
};

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/18.4',
];

let proxyIndex = 0;
function pickProxy() {
  if (!TEST_PROXIES || TEST_PROXIES.length === 0) return null;
  const p = TEST_PROXIES[proxyIndex % TEST_PROXIES.length];
  proxyIndex++;
  return p;
}

function ts() { return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ===== 单次 batch-preview 请求 =====
function batchPreview() {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      productId: 'product-02434c',
      billingCycle: 'month',
      autoRenew: true,
      ticket: '',
      randstr: '',
    });

    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const proxyUrl = pickProxy();

    const headers = {
      'accept': '*/*',
      'authorization': AUTH_TOKEN,
      'bigmodel-organization': 'org-2D97D0B3D47E441B89c56fE7f138ABBf',
      'bigmodel-project': 'proj_1Cd4b480482F4eEFbe43eB20E2Da5c18',
      'origin': 'https://bigmodel.cn',
      'referer': 'https://bigmodel.cn/glm-coding',
      'user-agent': ua,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    };

    const t0 = Date.now();
    let options;

    if (proxyUrl) {
      const pu = new URL(proxyUrl);
      options = {
        hostname: pu.hostname,
        port: parseInt(pu.port) || 80,
        path: 'https://bigmodel.cn/api/biz/pay/batch-preview',
        method: 'POST',
        headers,
        timeout: 10000,
      };
    } else {
      options = {
        hostname: 'bigmodel.cn',
        path: '/api/biz/pay/batch-preview',
        method: 'POST',
        headers,
        timeout: 10000,
      };
    }

    const mod = proxyUrl ? http : https;
    const req = mod.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const elapsed = Date.now() - t0;
          const is555 = j.code === 555 || (j.msg && j.msg.includes('繁忙'));
          resolve({ elapsed, is555, code: j.code, success: j.code === 200 });
        } catch {
          resolve({ elapsed: Date.now() - t0, is555: true, error: true });
        }
      });
    });

    req.on('error', () => resolve({ elapsed: Date.now() - t0, is555: true, error: true }));
    req.on('timeout', () => { req.destroy(); resolve({ elapsed: Date.now() - t0, is555: true, error: true }); });
    req.write(body);
    req.end();
  });
}

// ===== 测试模式 =====
const TEST_MODES = [
  { name: '单发无间隔',                  batchSize: 1, intervalMs: 0, repeats: 15 },
  { name: '单发间隔300ms',               batchSize: 1, intervalMs: 300, repeats: 15 },
  { name: '并发3个',                     batchSize: 3, intervalMs: 0, repeats: 5 },
  { name: '并发2个间隔200ms（推荐方案）', batchSize: 2, intervalMs: 200, repeats: 8 },
  { name: '并发3个间隔200ms',            batchSize: 3, intervalMs: 200, repeats: 6 },
  { name: '并发3个间隔400ms',            batchSize: 3, intervalMs: 400, repeats: 6 },
  { name: '并发5个间隔300ms',            batchSize: 5, intervalMs: 300, repeats: 4 },
  { name: '并发2个间隔100ms（激进）',    batchSize: 2, intervalMs: 100, repeats: 8 },
];

// ===== 运行测试 =====
async function runTest(mode) {
  const { name, batchSize, intervalMs, repeats } = mode;
  let total555 = 0;
  let totalOk = 0;
  let totalErrors = 0;
  let totalElapsed = 0;
  let requestCount = 0;

  log(`\n━━━ 测试: ${name} ━━━`);
  log(`批次: ${batchSize}个 | 间隔: ${intervalMs}ms | 重复: ${repeats}次`);

  for (let round = 0; round < repeats; round++) {
    // 发一批
    const batch = [];
    for (let i = 0; i < batchSize; i++) {
      batch.push(batchPreview());
    }

    const results = await Promise.all(batch);

    for (const r of results) {
      requestCount++;
      totalElapsed += r.elapsed;
      if (r.is555) total555++;
      else if (r.success) totalOk++;
      else totalErrors++;
    }

    // 实时打 555 标记
    const round555 = results.filter(r => r.is555).length;
    const roundOk = results.filter(r => r.success).length;
    const marker = round555 > 0 ? (round555 === batchSize ? '🔴全部555 ' : `⚠️${round555}/${batchSize}个555 `) : '✅';
    if (round < 5 || round555 > 0 || round === repeats - 1) {
      const avgElapsed = results.reduce((s, r) => s + r.elapsed, 0) / results.length;
      log(`  第 ${round + 1}/${repeats} 批: ${marker} (${avgElapsed.toFixed(0)}ms)`);
    }

    // 下一批间隔
    if (intervalMs > 0 && round < repeats - 1) {
      await sleep(intervalMs * (0.8 + Math.random() * 0.4)); // 加抖动
    }
  }

  const avgElapsed = requestCount > 0 ? totalElapsed / requestCount : 0;
  const rate = requestCount > 0 ? (total555 / requestCount * 100).toFixed(0) : '?';

  let verdict;
  if (total555 === 0) verdict = '✅ 安全 → 适合秒杀';
  else if (total555 / requestCount < 0.15) verdict = '⚠️ 轻度限流 → 配合代理可接受';
  else if (total555 / requestCount < 0.3) verdict = '⚠️ 中高度限流 → 建议调小批次或拉大间隔';
  else verdict = '🔴 严重限流 → 此策略不可用';

  return {
    name,
    batchSize,
    intervalMs,
    totalOk,
    total555,
    totalErrors,
    rate: parseInt(rate),
    avgElapsed: Math.round(avgElapsed),
    verdict,
    totalRequests: requestCount,
  };
}

// ===== 主入口 =====
async function main() {
  console.log('='.repeat(55));
  console.log('🔬 限流压力测试 - 用 batch-preview 探测服务器阈值');
  if (TEST_PROXIES) console.log(`代理: ${TEST_PROXIES.length} 个`);
  console.log('='.repeat(55));
  console.log('');
  log('⚠️  服务器忙时测试才准，闲时测出来全都 0% 555');
  log('   建议在秒杀时段前后 10 分钟跑，最接近真实情况');
  console.log('');

  // 先验证连通性
  log('验证连通性...');
  const warmup = await batchPreview();
  if (!warmup.success && !warmup.is555) {
    log(`❌ 无法连接 bigmodel.cn 或 AUTH_TOKEN 无效`);
    process.exit(1);
  }
  log(`✅ 连通 (${warmup.elapsed}ms)`);
  console.log('');

  const results = [];

  for (const mode of TEST_MODES) {
    const r = await runTest(mode);
    results.push(r);
    // 每轮之间休息一下，让服务器缓过来
    await sleep(2000);
  }

  // ===== 结论 =====
  console.log('\n' + '='.repeat(55));
  console.log('📊 测试结论');
  console.log('='.repeat(55));
  console.log('');

  const header = `  ${'策略'.padEnd(28)} ${'555率'.padEnd(8)} ${'延迟'.padEnd(8)} ${'结论'.padEnd(30)}`;
  console.log(header);
  console.log('  ' + '─'.repeat(74));

  results.sort((a, b) => a.rate - b.rate);

  for (const r of results) {
    const label = `${r.name}`.padEnd(28);
    const rateStr = `${r.rate}% (${r.total555}/${r.totalRequests})`.padEnd(8);
    const delay = `${r.avgElapsed}ms`.padEnd(8);
    console.log(`  ${label} ${rateStr} ${delay} ${r.verdict}`);
  }

  // 最佳推荐
  console.log('\n' + '─'.repeat(55));
  const best = results[0]; // 已按 555 率排序
  console.log(`\n🏆 推荐参数（基于测试结果）:\n`);

  if (best.rate === 0) {
    console.log(`   batchSize: ${best.batchSize}`);
    console.log(`   batchIntervalMs: ${best.intervalMs}`);
    console.log(`   估计可在 ${best.rate}% 的干净请求下运行`);
  } else {
    // 从结果中找第一个 555 率 < 15% 的
    const good = results.find(r => r.rate < 15) || results[0];
    console.log(`   batchSize: ${good.batchSize}`);
    console.log(`   batchIntervalMs: ${good.intervalMs}`);
    console.log(`   预计 555 率: ~${good.rate}%`);
    if (good.rate > 10) {
      console.log(`   ⚠️ 建议配合代理轮换以降低 555 率`);
    }
  }

  console.log('\n' + '─'.repeat(55));
  log('提示: 测试用的是 batch-preview（不费 ticket），');
  log('实际 pay/preview 的 555 率可能略有不同，但趋势一致。');
}

main().catch(e => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
