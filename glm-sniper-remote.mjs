#!/usr/bin/env node
/**
 * 智谱 GLM Coding Plan 抢购脚本 (v5 - 并发冲票)
 *
 * 流程:
 *   1. 启动后先输入验证码 ticket + randstr（9:58 操作）
 *   2. 脚本存好凭证，开始轮询全部方案库存（无验证码）
 *   3. 哪个有货就下哪个（优先级: Lite > Pro > Max）
 *   4. 并发用全部 ticket 同时打 pay/preview → 谁先拿到 bizId 就用谁下单
 *
 * 用法: node glm-sniper-remote.mjs
 */

import https from 'https';
import readline from 'readline';
import { AUTH_TOKEN, CUSTOMER_ID } from './config.mjs';
import {
  startServer, openBrowser, setPhase, shiftTicket, poolSize, state,
} from './ticket-server.mjs';

// ===== 配置 =====
const CONFIG = {
  billingCycle: 'month',  // batch-preview 查询用（服务器会返回全部商品，含季付/年付）
  autoRenew: true,
  checkInterval: 0.2,     // 轮询间隔(秒)
  payType: 'WE_CHAT',     // WE_CHAT | ALI
};

// 监控的商品（月付 + 季付 + 年付）
// cycle 是下单 pay/preview 需要的 billingCycle 值（月付=month, 季付=quarter, 年付=annual）
// priority 抢购优先级：Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年
const PRODUCTS = [
  { id: 'product-02434c', name: 'Lite月付', cycle: 'month',   price: '¥49/月',      priority: 1 },
  { id: 'product-b8ea38', name: 'Lite季付', cycle: 'quarter', price: '¥132.3/季',   priority: 2 },
  { id: 'product-1df3e1', name: 'Pro月付',  cycle: 'month',   price: '¥149/月',     priority: 3 },
  { id: 'product-fef82f', name: 'Pro季付',  cycle: 'quarter', price: '¥402.3/季',   priority: 4 },
  { id: 'product-2fc421', name: 'Max月付',  cycle: 'month',   price: '¥469/月',     priority: 5 },
  { id: 'product-5d3a03', name: 'Max季付',  cycle: 'quarter', price: '¥1266.3/季',  priority: 6 },
  { id: 'product-70a804', name: 'Lite年付', cycle: 'annual',  price: '¥470.4/年',   priority: 7 },
  { id: 'product-5643e6', name: 'Pro年付',  cycle: 'annual',  price: '¥1430.4/年',  priority: 8 },
  { id: 'product-d46f8b', name: 'Max年付',  cycle: 'annual',  price: '¥4502.4/年',  priority: 9 },
];

const REFER_1090 = '2651886234-6t53exaRAOcv1bxpC3Q1OxE3AC%3DOkx1yTcppTx6kItu7vP6nx08pZfjr5c9P2EhPNOxBBuRxfkcWxOBuKnxxJxoRBlY3xnI86x03xHx936fxa3847xQip9AtP3lNVxisOcCxlnxlx4jGEx4wIx6yxukc_x4gWlTM7O4JyVuB%3DI6ZVxxMRPeMJIncAf8cQ94JDu6pvnx';

const HEADERS = {
  'accept': '*/*',
  'authorization': AUTH_TOKEN,
  'bigmodel-organization': 'org-2D97D0B3D47E441B89c56fE7f138ABBf',
  'bigmodel-project': 'proj_1Cd4b480482F4eEFbe43eB20E2Da5c18',
  'origin': 'https://bigmodel.cn',
  'referer': 'https://bigmodel.cn/glm-coding',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function ts() { return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }); }
function log(msg) { console.log(`[${ts()}] ${msg}`); }

function api(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
    const h = { ...HEADERS };
    let bs = null;
    if (body) { bs = JSON.stringify(body); h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(bs); }
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers: h, timeout: 15000 },
      (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ parseError: true, raw: d.slice(0, 300) }); } });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (bs) req.write(bs);
    req.end();
  });
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a); }));
}

// ===== 步骤 1: 启动服务 + 等待 ticket 入池 =====
// ticket 池由 ticket-server.mjs 维护，浏览器自动 POST 推送
function printBanner() {
  console.log('='.repeat(60));
  console.log('GLM Coding Plan 抢购脚本 v7 — 自动出码版');
  console.log('监控: Lite月¥49 | Lite季¥132.3 | Pro月¥149 | Pro季¥402.3 | Max月¥469 | Max季¥1266.3 | Lite年¥470.4 | Pro年¥1430.4 | Max年¥4502.4');
  console.log('策略: 哪个有货下哪个，优先级 Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年');
  console.log(`支付: ${CONFIG.payType === 'WE_CHAT' ? '微信' : '支付宝'}`);
  console.log('='.repeat(60));
  console.log('');
}

// 等待池子里至少有 minSize 个 ticket
function waitForTickets(minSize = 1) {
  return new Promise((resolve) => {
    if (poolSize() >= minSize) { resolve(); return; }
    log(`⏳ 等待至少 ${minSize} 个 ticket 入池（当前 ${poolSize()} 个）...`);
    log('   浏览器里点「自动循环出码」，拖滑块即可，脚本会自动接力');
    const timer = setInterval(() => {
      if (poolSize() >= minSize) {
        clearInterval(timer);
        log(`✅ 池子已有 ${poolSize()} 个 ticket，继续`);
        resolve();
      }
    }, 500);
  });
}

// ===== 步骤 2: 验证登录 =====
async function verifyAuth() {
  const r = await api('GET', '/api/biz/product/isLimitBuy');
  if (r.code === 200) return true;
  log(`❌ 登录失效: ${JSON.stringify(r)}`);
  return false;
}

// ===== 步骤 3: 查库存 - 返回全部方案的库存状态 =====
// 返回: { ok:true, products:[], raw:object } | { ok:false, reason, raw }
async function checkAllStock(cycle, renew) {
  // batch-preview 查询值传入 Lite 的 productId，看是否返回全部
  const r = await api('POST', '/api/biz/pay/batch-preview', {
    productId: 'product-02434c',
    billingCycle: cycle,
    autoRenew: renew,
    ticket: '',
    randstr: '',
  });
  if (r.code !== 200) return { ok: false, reason: r.msg || `http_${r.code}`, raw: r };

  // 从返回列表中匹配已知方案
  const allProducts = r.data?.productList || [];
  const matched = PRODUCTS.map(p => {
    const apiP = allProducts.find(a => a.productId === p.id);
    return { ...p, apiData: apiP || null };
  });
  return { ok: true, products: matched, raw: r };
}

// ===== 步骤 4: 下单（从共享池取全部 ticket 并发冲） =====
async function placeOrder(productInfo) {
  // 按优先级选可买的
  const available = productInfo
    .filter(p => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) return { error: '无可买方案' };
  if (poolSize() === 0) return { error: 'ticket 池为空' };

  // 把池子里全部 ticket 取出一次性并发冲
  const tickets = [];
  while (poolSize() > 0) tickets.push(shiftTicket());

  const target = available[0];
  const { id: productId, name, cycle } = target;
  log(`🎯 下单 ${name} (${productId}, cycle=${cycle})，并发 ${tickets.length} 个 ticket...`);
  return await concurrentPlaceOrder(productId, name, cycle, tickets);
}

// ===== 步骤 4b: 并发下单（多 ticket 同时冲） =====
async function concurrentPlaceOrder(productId, productName, billingCycle, tickets) {
  // 同时发所有 ticket 的 pay/preview 请求
  const promises = tickets.map((cred, i) => {
    const { ticket, randstr } = cred;
    return api('POST', `/api/biz/pay/preview?refer__1090=${REFER_1090}`, { productId, billingCycle, ticket, randstr })
      .then(res => ({ ticketIdx: i, success: true, result: res }))
      .catch(err => ({ ticketIdx: i, success: false, error: err.message }));
  });

  log(`🚀 并发请求已发出，等待返回...`);
  const results = await Promise.all(promises);

  // 找第一个成功的（code:200 且有 bizId）
  let winner = null;
  for (const r of results) {
    if (r.success && r.result.code === 200 && r.result.data?.bizId) {
      winner = r;
      break;
    }
  }

  // 打印所有结果（方便调试）
  for (const r of results) {
    if (r.success) {
      const d = r.result;
      log(`  [票#${r.ticketIdx + 1}] code:${d.code} ${d.data?.bizId ? '✅ bizId:' + d.data.bizId : d.data?.soldOut ? '售罄' : d.msg}`);
    } else {
      log(`  [票#${r.ticketIdx + 1}] ❌ ${r.error}`);
    }
  }

  if (!winner) {
    return { error: `本批 ${results.length} 个 ticket 全部失败` };
  }

  const { bizId, soldOut, payAmount } = winner.result.data;
  if (soldOut) return { error: '下单时已售罄' };
  log(`🏆 票#${winner.ticketIdx + 1} 命中！bizId: ${bizId}, 金额: ¥${payAmount}`);

  // create-sign → 支付链接（串行，只有一次请求，不会消耗 ticket）
  log('▶️ create-sign...');
  const sign = await api('POST', `/api/biz/pay/create-sign`, { payType: CONFIG.payType, productId, customerId: CUSTOMER_ID, bizId });
  log(`   → ${JSON.stringify(sign).slice(0, 400)}`);

  if (sign.code === 200 && sign.data) {
    return { success: true, productName, bizId, payAmount, data: sign.data };
  }
  return { error: `create-sign: ${sign.msg || JSON.stringify(sign)}` };
}

// ===== 主流程 =====
async function main() {
  printBanner();

  // 1. 启动 ticket 服务 + 打开浏览器
  startServer();
  openBrowser();
  setPhase('collecting', '等待拖滑块');
  console.log('');
  console.log('📌 操作：在弹出的浏览器里点「⚡ 自动循环出码」');
  console.log('   拖完一个滑块会自动入池，脚本会持续监控库存');
  console.log('   抢到或抢购结束会自动通知浏览器停止');
  console.log('');

  // 2. 验证登录（不等 ticket，先验 token）
  if (!await verifyAuth()) {
    setPhase('failed', '登录失效');
    log('❌ 登录失效，请检查 config.mjs 的 AUTH_TOKEN');
    log('   服务保持运行，修复 token 后重启脚本');
    // 不直接 exit，让 server 留着方便看状态；按 Ctrl+C 退出
    return;
  }
  log('✅ 登录有效');

  // 3. 等首批 ticket（至少 1 个）入池
  await waitForTickets(1);

  // 4. 进入抢购循环：库存监控 + 下单
  setPhase('sniping', `池子 ${poolSize()} 个 ticket`);
  let checkCount = 0;
  let ordered = false;
  log('🔄 开始监控全部方案库存（200ms/次，Ctrl+C 停止）...');

  while (!ordered) {
    checkCount++;
    try {
      const stock = await checkAllStock(CONFIG.billingCycle, CONFIG.autoRenew);

      if (stock.ok) {
        // 检查哪些方案有库存
        const available = stock.products
          .filter(p => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
          .sort((a, b) => a.priority - b.priority);

        // 显示各方案状态
        const statusLine = stock.products.map(p => {
          if (!p.apiData) return `${p.name}:?`;
          if (p.apiData.soldOut) return `${p.name}:🟡`;
          if (p.apiData.forbidden) return `${p.name}:🔴`;
          return `${p.name}:🟢`;
        }).join(' ');
        log(`${statusLine} | 池:${poolSize()} | #${checkCount}`);

        if (available.length > 0) {
          const target = available[0];
          log(`🎉🎉🎉 ${target.name} 有库存！#${checkCount}`);

          // 池子空了就等新 ticket
          if (poolSize() === 0) {
            log('⏳ 池子暂时空了，等待新 ticket 入池...');
            await waitForTickets(1);
          }

          // 立即下单
          const result = await placeOrder(stock.products);

          if (result.success) {
            ordered = true;
            setPhase('done', `${result.productName} ¥${result.payAmount}`);
            console.log('\n' + '✅'.repeat(20));
            console.log(`✅ 下单成功！(${result.productName})`);
            console.log(`   订单: ${result.data.orderId || '未知'}`);
            console.log(`   金额: ¥${result.payAmount}`);
            if (result.data.sign) {
              console.log(`   支付链接: ${result.data.sign}`);
              console.log('   打开链接扫码支付 ⬆️');
            } else {
              console.log(`   响应: ${JSON.stringify(result.data)}`);
              console.log('   前往 https://bigmodel.cn/coding-plan/personal/overview 查看');
            }
            break;
          } else {
            log(`❌ 下单失败: ${result.error}`);
            // 不再退出：等新 ticket 入池后继续抢
            if (poolSize() === 0) {
              log('⏳ ticket 池空了，等新 ticket 入池继续...');
              setPhase('collecting', 'ticket 耗尽，请继续拖滑块');
              await waitForTickets(1);
              setPhase('sniping', `池子 ${poolSize()} 个 ticket`);
            }
          }
        }
      } else {
        // 查询失败（555 限流等）
        log(`🔴${stock.reason} | #${checkCount}`);
      }
    } catch (e) {
      log(`⚠️ 查询异常: ${e.message}`);
    }

    if (!ordered) {
      await new Promise(r => setTimeout(r, CONFIG.checkInterval * 1000));
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50)));
    }
  }

  if (!ordered) {
    setPhase('failed', '异常退出');
    log('❌ 脚本已停止（未下单）');
  }
}

main().catch(e => {
  setPhase('failed', e.message);
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
