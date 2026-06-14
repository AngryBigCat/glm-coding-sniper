#!/usr/bin/env node
/**
 * GLM Coding Plan 抢购脚本 v6 — 秒杀优化版
 *
 * ⚠️ 针对秒杀场景，关键思路:
 *
 *   1. 不并发冲 27 个 ticket（全部被一个 IP 限流 555，全浪费）
 *   2. 改成 2~3 个一批并行，每批间隔 150~400ms
 *   3. 每个 ticket 用不同 User-Agent，减小指纹命中
 *   4. 支持多代理轮换（每个 ticket 挂不同出口 IP）
 *   5. Pre-warm: 开售前就开始零星请求让服务器"认识"你
 *   6. 不查库存，直接循环下单（秒杀时查完就没）
 *
 * 用法:
 *   node glm-sniper-remote-v2.mjs         正常抢购
 *   node test_rate_limit.mjs              先用这个测策略效果（不费 ticket）
 */

import https from 'https';
import http from 'http';
import readline from 'readline';
import { AUTH_TOKEN, CUSTOMER_ID } from './config.mjs';

// ====================================================================
// ⚙️ 配置
// ====================================================================
const CONFIG = {
  targetSku: 'auto',       // auto / lite / pro / max
  billingCycle: 'month',
  autoRenew: true,
  payType: 'WE_CHAT',

  // 每批并发几个 ticket（建议 2-3）
  batchSize: 3,

  // 批间隔(毫秒)：每批之间等多久（建议 150-400ms）
  batchIntervalMs: 250,

  // 多代理轮换 (填 null 则直连)
  // 每个 ticket 轮流使用不同代理，分散 IP 限流
  // 如果只有 1 个代理，也要填数组形式：['http://127.0.0.1:7890']
  proxies: null,
  // proxies: ['http://proxy1:port', 'http://proxy2:port', 'http://proxy3:port'],
};

// ====================================================================
// User-Agent 池（每个 ticket 随机选一个，减小指纹）
// ====================================================================
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:136.0) Gecko/20100101 Firefox/136.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
];

// ====================================================================
// 套餐
// ====================================================================
const PRODUCT_ID_MAP = {
  lite: 'product-02434c',
  pro:  'product-1df3e1',
  max:  'product-2fc421',
};

const PRODUCT_NAMES = {
  'product-02434c': 'Lite',
  'product-1df3e1': 'Pro',
  'product-2fc421': 'Max',
};

// 优先级顺序
const PRODUCT_PRIORITY = [
  'product-02434c', // Lite
  'product-1df3e1', // Pro
  'product-2fc421', // Max
];

const REFER_1090 = '2651886234-6t53exaRAOcv1bxpC3Q1OxE3AC%3DOkx1yTcppTx6kItu7vP6nx08pZfjr5c9P2EhPNOxBBuRxfkcWxOBuKnxxJxoRBlY3xnI86x03xHx936fxa3847xQip9AtP3lNVxisOcCxlnxlx4jGEx4wIx6yxukc_x4gWlTM7O4JyVuB%3DI6ZVxxMRPeMJIncAf8cQ94JDu6pvnx';

// ====================================================================
// HTTP 请求（支持代理轮换）
// ====================================================================
let proxyIndex = 0;

function pickProxy() {
  if (!CONFIG.proxies || CONFIG.proxies.length === 0) return null;
  const p = CONFIG.proxies[proxyIndex % CONFIG.proxies.length];
  proxyIndex++;
  return p;
}

function api(method, path, body = null, customAgent = null, customUa = null) {
  return new Promise((resolve, reject) => {
    const fullUrl = path.startsWith('http') ? path : `https://bigmodel.cn${path}`;
    const url = new URL(fullUrl);

    const ua = customUa || USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const headers = {
      'accept': '*/*',
      'authorization': AUTH_TOKEN,
      'bigmodel-organization': 'org-2D97D0B3D47E441B89c56fE7f138ABBf',
      'bigmodel-project': 'proj_1Cd4b480482F4eEFbe43eB20E2Da5c18',
      'origin': 'https://bigmodel.cn',
      'referer': 'https://bigmodel.cn/glm-coding',
      'user-agent': ua,
    };

    let bs = null;
    if (body) {
      bs = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(bs);
    }

    // 代理
    const proxyUrlStr = customAgent || pickProxy();
    let options;
    if (proxyUrlStr) {
      const pu = new URL(proxyUrlStr);
      options = {
        hostname: pu.hostname,
        port: parseInt(pu.port) || 80,
        path: fullUrl,
        method,
        headers,
        timeout: 12000,
      };
    } else {
      options = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers,
        timeout: 12000,
      };
    }

    const mod = proxyUrlStr ? http : https;

    const req = mod.request(options, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { resolve({ parseError: true, raw: d.slice(0, 200) }); }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (bs) req.write(bs);
    req.end();
  });
}

// ====================================================================
// 工具
// ====================================================================
function ts() { return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function rand(min, max) { return min + Math.random() * (max - min); }

// ====================================================================
// 步骤 1: 输入 ticket
// ====================================================================
let ticketQueue = [];

async function inputCredentials() {
  console.log('='.repeat(55));
  console.log('GLM Coding Plan 抢购脚本 v6（秒杀版）');
  console.log(`批次并发: ${CONFIG.batchSize} 个/批 | 批间隔: ${CONFIG.batchIntervalMs}ms`);
  console.log(`目标: ${CONFIG.targetSku} | 支付: ${CONFIG.payType}`);
  if (CONFIG.proxies) console.log(`代理数: ${CONFIG.proxies.length} 个（轮换）`);
  console.log('='.repeat(55));
  console.log('');
  console.log('📥 粘贴凭证（每行一组 ticket + randstr），完成后 Ctrl+D：');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      ticketQueue.push({ ticket: parts[0], randstr: parts[1] });
      console.log(`  ✅ #${ticketQueue.length}: ${parts[0].slice(0, 24)}...`);
    } else {
      console.log(`  ⚠️ 跳过: ${trimmed.slice(0, 40)}`);
    }
  }

  if (ticketQueue.length === 0) { log('❌ 未输入凭证'); process.exit(1); }
  log(`✅ 已保存 ${ticketQueue.length} 个 ticket\n`);
}

// ====================================================================
// 验证
// ====================================================================
async function verifyAuth() {
  try {
    const r = await api('GET', '/api/biz/product/isLimitBuy');
    return r.code === 200;
  } catch { return false; }
}

// ====================================================================
// 查库存（不费 ticket，用于 pre-warm + 监测）
// ====================================================================
async function checkStock() {
  return await api('POST', '/api/biz/pay/batch-preview', {
    productId: 'product-02434c',
    billingCycle: CONFIG.billingCycle,
    autoRenew: CONFIG.autoRenew,
    ticket: '',
    randstr: '',
  });
}

// 解析可用产品
function parseAvailable(raw) {
  if (raw.code !== 200 || !raw.data?.productList) return [];

  const list = raw.data.productList;

  // 过滤目标产品
  const available = PRODUCT_PRIORITY.filter(pid => {
    const p = list.find(x => x.productId === pid);
    return p && !p.soldOut && !p.forbidden;
  });

  return available;
}

// ====================================================================
// 下单（消耗 1 ticket，每次用不同 UA 和代理）
// ====================================================================
async function tryOrderBatch(tickets, targetProductIds) {
  // 每个 ticket 随机分配不同的 UA
  const promises = tickets.map(t => {
    const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    // 如果是第一个 ticket 用最高优先级产品，后面的也可以用，但可能前一个已经成功了就不需要了
    return api('POST', `/api/biz/pay/preview?refer__1090=${REFER_1090}`, {
      productId: targetProductIds[0], // 所有 ticket 都用同一个目标
      ticket: t.ticket,
      randstr: t.randstr,
    }, null, ua);
  });

  return await Promise.allSettled(promises);
}

async function doCreateSign(productId, bizId) {
  return await api('POST', `/api/biz/pay/create-sign`, {
    payType: CONFIG.payType,
    productId,
    customerId: CUSTOMER_ID,
    bizId,
  });
}

// ====================================================================
// 主循环 — 秒杀模式
// ====================================================================
async function main() {
  await inputCredentials();

  if (!await verifyAuth()) {
    log('❌ 登录失效');
    process.exit(1);
  }
  log('✅ 登录有效');

  // ===== 秒杀模式: 不提前查库存，先发 pre-warm 请求 =====
  // pre-warm: 用 batch-preview 发少量请求，让服务器知道你
  // （batch-preview 不费 ticket）
  log('🌡️  Pre-warm: 发送探测请求...');
  let stockOk = false;
  for (let i = 0; i < 3; i++) {
    const r = await checkStock();
    if (r.code === 200) {
      log(`  ✅ batch-preview 连通 (尝试 ${i + 1}/3)`);
      stockOk = true;
      break;
    } else {
      log(`  ⚠️  batch-preview ${r.code || r.msg?.slice(0, 30)} (尝试 ${i + 1}/3)`);
      await sleep(500);
    }
  }
  if (!stockOk) log('  ⚠️  batch-preview 不通，继续尝试...');

  // ===== 确定目标 productId =====
  let targetProductIds;
  if (CONFIG.targetSku === 'auto') {
    // 先查一次看看有什么
    const r = await checkStock();
    const available = parseAvailable(r);
    if (available.length > 0) {
      targetProductIds = available;
    } else {
      targetProductIds = PRODUCT_PRIORITY; // 按优先级
    }
  } else {
    targetProductIds = [PRODUCT_ID_MAP[CONFIG.targetSku] || 'product-02434c'];
  }

  log(`🎯 目标产品: ${targetProductIds.map(id => PRODUCT_NAMES[id] || id).join(' > ')}`);

  // ===== 秒杀循环 =====
  let ordered = false;
  let totalUsed = 0;
  let batchNum = 0;
  let consecutive555 = 0;
  let lastBatchTime = 0;

  log(`\n🚀 开始秒杀循环（每批 ${CONFIG.batchSize} 个，间隔 ${CONFIG.batchIntervalMs}ms）...`);
  log(`   共 ${ticketQueue.length} 个 ticket 可用`);

  while (!ordered && ticketQueue.length > 0) {
    batchNum++;

    // 取一批 ticket
    const batch = ticketQueue.splice(0, CONFIG.batchSize);
    if (batch.length === 0) break;

    const t0 = Date.now();
    totalUsed += batch.length;

    // ---- 发这一批 ----
    // 如果连续 555 较多，用更低优先级产品试试
    let targets = targetProductIds;
    if (consecutive555 >= 3 && CONFIG.targetSku === 'auto') {
      // 连续 555 3 次以上时，可能需要换个产品
      // 仍按优先级，但打个日志
    }

    const results = await tryOrderBatch(batch, targets);
    const elapsedBatch = Date.now() - t0;

    // ---- 检查结果 ----
    let foundSuccess = false;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];

      if (r.status === 'rejected') {
        log(`  ⏱️ ${elapsedBatch}ms | [batch#${batchNum} 票${i + 1}] ❌ 网络错误: ${r.reason?.message?.slice(0, 60)}`);
        continue;
      }

      const result = r.value;

      if (result.code === 200 && result.data?.bizId && !result.data?.soldOut) {
        // ✅ 命中！
        const { bizId, payAmount } = result.data;
        const productId = bizId ? targets[0] : ''; // 实际 productId 需从上下文获取
        const productName = PRODUCT_NAMES[targets[0]] || targets[0];
        log(`🎯 批 #${batchNum} | 票 ${i + 1}/${batch.length} | ✅ 命中！bizId:${bizId} ¥${payAmount} (${elapsedBatch}ms)`);

        // create-sign
        log(`▶️ create-sign...`);
        const sign = await doCreateSign(targets[0], bizId);

        if (sign.code === 200 && sign.data) {
          ordered = true;
          printSuccess(productName, payAmount, sign.data);
        } else {
          log(`⚠️ create-sign 失败: ${sign.msg || JSON.stringify(sign).slice(0, 200)}`);
          log('但 bizId 已生成，可以手动支付');
          ordered = true;
        }
        foundSuccess = true;
        break;
      }
      // soldOut
      else if (result.data?.soldOut) {
        log(`  ⏱️ ${elapsedBatch}ms | [batch#${batchNum} 票${i + 1}] ❌ 售罄`);
      }
      // 555
      else if (result.code === 555 || result.msg?.includes('繁忙')) {
        consecutive555++;
        const showDetail = consecutive555 <= 3 || consecutive555 % 5 === 0;
        if (showDetail) {
          log(`  ⏱️ ${elapsedBatch}ms | [batch#${batchNum} 票${i + 1}] 🔴 555 #${consecutive555}`);
        }
      }
      // 其他错误
      else {
        log(`  ⏱️ ${elapsedBatch}ms | [batch#${batchNum} 票${i + 1}] ❌ [${result.code}] ${(result.msg || '').slice(0, 50)}`);
      }
    }

    if (foundSuccess) break;

    // ---- 批间隔 ----
    // 根据 555 的密度动态调整间隔
    let interval = CONFIG.batchIntervalMs;
    if (consecutive555 >= 5) {
      // 连续 555 太多，稍微拉长间隔
      interval = Math.min(interval * 1.5, 1000);
    } else if (consecutive555 >= 3) {
      interval = interval * 1.2;
    } else if (consecutive555 > 0 && consecutive555 % 2 === 0) {
      // 偶尔有 555，略等一下
      interval = interval * 1.1;
    }

    // 加随机抖动
    const waitMs = interval * rand(0.7, 1.3);
    await sleep(waitMs);

    // ---- 每 5 批显示一次进度 ----
    if (batchNum % 5 === 0) {
      const left = ticketQueue.length;
      const used = totalUsed;
      log(`📊 [批 #${batchNum}] 已用 ${used} 票 | 剩余 ${left} 票 | 555:${consecutive555}`);
    }
  }

  // ---- 退出总结 ----
  if (!ordered) {
    console.log('\n' + '─'.repeat(45));
    log(`📊 运行结束（未下单）`);
    log(`   总计使用: ${totalUsed} 个 ticket`);
    log(`   剩余: ${ticketQueue.length} 个`);
    log(`   遇到 555: ${consecutive555} 次`);
    console.log('\n建议:');
    console.log('   1. 备更多 ticket（15-20 个）再试');
    if (!CONFIG.proxies) console.log('   2. 配置多代理轮换（proxies 配置项），分散 IP')
    console.log('   3. 如果 555 特别多，可能是被风控了，换个网络环境');
  }
}

// ====================================================================
// 成功输出
// ====================================================================
function printSuccess(name, amount, data) {
  console.log('\n' + '✅'.repeat(30));
  console.log(`✅ 抢购成功！(${name})`);
  console.log(`   金额: ¥${amount}`);
  console.log(`   订单: ${data.orderId || data.payOrderNo || '未知'}`);
  const url = data.sign || data.payUrl || data.mwebUrl;
  if (url) {
    console.log(`   支付链接: ${url}`);
    console.log('   ⬆️ 复制到浏览器打开扫码付钱');
  } else {
    console.log('   前往 https://bigmodel.cn/coding-plan/personal/overview 查看');
  }
  console.log('✅'.repeat(30));
}

main().catch(e => {
  log(`💥 致命错误: ${e.message}`);
  process.exit(1);
});
