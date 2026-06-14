#!/usr/bin/env node
/**
 * 智谱 GLM Coding Plan 抢购脚本（本地版）
 * 需要在已登录 bigmodel.cn 的浏览器上运行
 * 
 * 用法：
 *   1. 先在 Chrome 登录 bigmodel.cn 并保持登录
 *   2. 找到 Chrome 用户数据目录
 *   3. 运行: node glm-sniper.mjs
 */

import { chromium } from 'playwright';

const CONFIG = {
  // Chrome 用户数据目录路径（需根据实际情况修改）
  // macOS: /Users/用户名/Library/Application Support/Google/Chrome
  // Windows: C:\Users\用户名\AppData\Local\Google\Chrome\User Data
  // Linux: /home/用户名/.config/google-chrome
  userDataDir: process.env.CHROME_USER_DATA || '',
  profileName: 'Profile 1',  // Chrome 默认 profile
  checkInterval: 3,          // 检查间隔（秒）
  maxChecks: 2000,
};

// 套餐配置
const PRODUCTS = {
  lite: { productId: 'product-003', name: 'Lite' },
  pro: { productId: 'product-005', name: 'Pro' },
  max: { productId: 'product-006', name: 'Max' },
};

const TARGET_PRODUCT = 'lite';  // 抢购目标
const BILLING_CYCLE = 'month';   // month / quarter / year
const AUTO_RENEW = true;         // 连续包月

function log(msg) {
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`[${time}] ${msg}`);
}

/**
 * 使用页面 fetch 调用 API（复用浏览器登录态）
 */
async function callApi(page, url, method = 'GET', body = null) {
  return page.evaluate(async ({ url, method, body }) => {
    const token = document.cookie
      .split('; ')
      .find(c => c.startsWith('bigmodel_token_production='))
      ?.split('=')[1];
    
    if (!token) throw new Error('未找到登录 token，请先登录 bigmodel.cn');

    const headers = {
      'Authorization': token,
    };
    if (body) headers['Content-Type'] = 'application/json';

    const resp = await fetch(url, {
      method,
      credentials: 'include',
      headers,
      body: body ? JSON.stringify(body) : null,
    });
    return resp.json();
  }, { url, method, body });
}

async function main() {
  log('='.repeat(50));
  log('GLM Coding Plan 抢购脚本');
  log(`目标: ${PRODUCTS[TARGET_PRODUCT]?.name || TARGET_PRODUCT} - ${BILLING_CYCLE}`);
  log('='.repeat(50));

  // 启动浏览器
  let browser;
  if (CONFIG.userDataDir) {
    log(`使用 Chrome 用户数据: ${CONFIG.userDataDir}/${CONFIG.profileName}`);
    browser = await chromium.launchPersistentContext(
      `${CONFIG.userDataDir}/${CONFIG.profileName}`,
      { headless: false }
    );
  } else {
    log('请先设置 CHROME_USER_DATA 环境变量');
    log('例如: CHROME_USER_DATA="/home/用户名/.config/google-chrome" node glm-sniper.mjs');
    process.exit(1);
  }

  const page = browser.pages()[0] || await browser.newPage();

  // 先打开页面确保登录态有效
  log('打开 bigmodel.cn 检查登录态...');
  await page.goto('https://bigmodel.cn/glm-coding', {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  await page.waitForTimeout(3000);

  // 验证登录态
  try {
    const authCheck = await callApi(page, 'https://bigmodel.cn/api/biz/product/isLimitBuy');
    if (authCheck.code === 401 || authCheck.code === 1001) {
      log('❌ 登录态无效！请确保浏览器已登录 bigmodel.cn');
      log('保持页面打开，登录后按 Enter 继续...');
      await new Promise(r => {
        process.stdin.once('data', r);
      });
    }
  } catch (e) {
    log(`验证失败: ${e.message}`);
    process.exit(1);
  }

  log('✅ 登录态有效，开始监控...');

  let checkCount = 0;
  let consecutiveErrors = 0;

  while (checkCount < CONFIG.maxChecks) {
    checkCount++;
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    log(`\n--- #${checkCount}/${CONFIG.maxChecks} [${now}] ---`);

    try {
      // 1. 检查是否限售
      const limitResult = await callApi(
        page,
        'https://bigmodel.cn/api/biz/product/isLimitBuy'
      );

      if (limitResult.code !== 200) {
        log(`⚠️ 接口异常: ${JSON.stringify(limitResult)}`);
        consecutiveErrors++;
        if (consecutiveErrors >= 5) {
          log('连续失败 5 次，请检查网络或登录态');
          break;
        }
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      consecutiveErrors = 0;
      const { isLimitBuy, isWhiteList } = limitResult.data || {};
      log(`限售: ${isLimitBuy ? '是 ❌' : '否 ✅'} | 白名单: ${isWhiteList}`);

      if (!isLimitBuy) {
        // 有库存，下单！
        log('🎉🎉🎉 有库存！开始下单...');

        // 2. 创建预下单
        const preOrder = await callApi(
          page,
          'https://bigmodel.cn/api/biz/product/createPreOrder',
          'POST',
          {
            productId: PRODUCTS[TARGET_PRODUCT].productId,
            billingCycle: BILLING_CYCLE,
            autoRenew: AUTO_RENEW,
          }
        );
        log(`预下单结果: ${JSON.stringify(preOrder)}`);

        if (preOrder.code === 200 && preOrder.data?.payOrderNo) {
          log(`✅ 预下单成功！订单号: ${preOrder.data.payOrderNo}`);
          log('请立即去浏览器完成支付！');
          // 打开支付页面
          await page.goto(
            `https://bigmodel.cn/coding-plan/personal/overview`,
            { waitUntil: 'domcontentloaded' }
          );
          await new Promise(() => {}); // 永远等待
        } else {
          log(`预下单失败: ${JSON.stringify(preOrder)}`);
        }
      }

      // 随机间隔
      const jitter = 0.8 + Math.random() * 0.4;
      const wait = CONFIG.checkInterval * jitter;
      log(`等待 ${wait.toFixed(1)}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));

    } catch (e) {
      log(`错误: ${e.message}`);
      consecutiveErrors++;
      if (consecutiveErrors >= 5) break;
      await new Promise(r => setTimeout(r, 5000));
    }
  }

  log('脚本退出');
  await browser.close();
}

main().catch(e => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
