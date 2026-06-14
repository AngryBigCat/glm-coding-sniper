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

// ===== 配置 =====
const CONFIG = {
  billingCycle: 'month',
  autoRenew: true,
  checkInterval: 0.2,     // 轮询间隔(秒)
  payType: 'WE_CHAT',     // WE_CHAT | ALI
};


const PRODUCTS = [
  { id: 'product-02434c', name: 'Lite', price: '¥49/月', priority: 1 },
  { id: 'product-1df3e1', name: 'Pro',  price: '¥149/月', priority: 2 },
  { id: 'product-2fc421', name: 'Max',  price: '¥469/月', priority: 3 },
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

// ===== 步骤 1: 输入验证码凭证 =====
// ===== 验证码凭证队列 =====
let ticketQueue = [];

function getNextTicket() {
  if (ticketQueue.length === 0) return null;
  const cred = ticketQueue.shift();
  log(`📋 使用凭证 #${ticketQueue.length + 1}，剩余 ${ticketQueue.length} 个`);
  return cred;
}

async function inputCredentials() {
  console.log('='.repeat(50));
  console.log('GLM Coding Plan 抢购脚本 v5 - 多凭证版');
  console.log('监控: Lite ¥49 | Pro ¥149 | Max ¥469');
  console.log('策略: 哪个有货下哪个，优先级 Lite > Pro > Max');
  console.log(`支付: ${CONFIG.payType === 'WE_CHAT' ? '微信' : '支付宝'}`);
  console.log('');
  console.log('⚠️ pay/preview 每次调用消耗 1 个 ticket，建议准备 3-5 个');
  console.log('='.repeat(50));
  console.log('');
  console.log('请在 captcha-helper.html 生成验证码，然后一键复制');
  console.log('或从 bigmodel.cn F12 Console 依次生成:');
  console.log('   new TencentCaptcha("196026326", function(res) { if(res.ret === 0) {');
  console.log('     console.log(res.ticket + " " + res.randstr);');
  console.log('   }}, {mode:"bind",type:"popup"}).show();');
  console.log('');
  console.log('📌 粘贴全部凭证（每行一组 ticket randstr），然后 Ctrl+D (Linux/Mac) 或 Ctrl+Z (Windows) 结束');
  console.log('   也可以一行行输入，最后 Ctrl+D 结束');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('📥 请粘贴（或输入）凭证，完成后 Ctrl+D：');

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      ticketQueue.push({ ticket: parts[0], randstr: parts[1] });
      console.log(`  ✅ #${ticketQueue.length}: ${parts[0].slice(0, 24)}...`);
    } else {
      console.log(`  ⚠️ 跳过: 需要 ticket + randstr，收到: ${trimmed.slice(0, 40)}`);
    }
  }

  if (ticketQueue.length === 0) { log('❌ 未输入凭证'); process.exit(1); }
  log(`✅ 已保存 ${ticketQueue.length} 个凭证，开始监控库存...\n`);
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

// ===== 步骤 4: 下单 =====
async function placeOrder(productInfo) {
  // 按优先级选可买的
  const available = productInfo
    .filter(p => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) return { error: '无可买方案' };
  if (ticketQueue.length === 0) return { error: 'ticket 已用完，请重新准备' };

  const target = available[0];
  const { id: productId, name } = target;
  log(`🎯 下单 ${name} (${productId})，并发发起 ${ticketQueue.length} 个 ticket 请求...`);
  return await concurrentPlaceOrder(productId, name, ticketQueue);
}

// ===== 步骤 4b: 并发下单（多 ticket 同时冲） =====
async function concurrentPlaceOrder(productId, productName, tickets) {
  // 同时发所有 ticket 的 pay/preview 请求
  const promises = tickets.map((cred, i) => {
    const { ticket, randstr } = cred;
    return api('POST', `/api/biz/pay/preview?refer__1090=${REFER_1090}`, { productId, ticket, randstr })
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
    // 全部失败，清空队列（ticket 已被消耗）
    const usedCount = results.length;
    ticketQueue.splice(0, usedCount);
    return { error: `全部失败，${usedCount} 个 ticket 已耗尽` };
  }

  // 成功！消耗掉已使用的 ticket，保留未参与本次的（理论上不会有）
  const usedCount = results.length;
  ticketQueue.splice(0, usedCount);

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
  // 1. 先输入凭证（多个）
  await inputCredentials();

  // 2. 验证登录
  if (!await verifyAuth()) process.exit(1);

  // 无限循环，直到下单成功或 Ctrl+C 中断
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

        // 加上原始响应
        const rawStr = JSON.stringify(stock.raw);
        log(`${statusLine} | ${rawStr}`);

        if (available.length > 0) {
          const target = available[0];
          log(`🎉🎉🎉 ${target.name} 有库存！#${checkCount}`);

          // 立即下单
          const result = await placeOrder(stock.products);

          if (result.success) {
            ordered = true;
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
            if (ticketQueue.length === 0) {
              log('🛑 ticket 队列已耗尽，停止脚本');
              console.log('\n👉 请准备新 ticket 后重新运行脚本，或手动购买');
              console.log('   https://bigmodel.cn/glm-coding');
              break;
            }
            log('🔄 换用下一个 ticket 继续...');
          }
        }
      } else {
        // 查询失败
        const rawStr = JSON.stringify(stock.raw);
        log(`🔴${stock.reason} | ${rawStr}`);
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
    // 正常不会走到这里，除非 ordered 为 false 但循环意外退出
    log('❌ 脚本已停止（未下单）');
  }
}

main().catch(e => { log(`致命错误: ${e.message}`); process.exit(1); });
