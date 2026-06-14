#!/usr/bin/env node
/**
 * 智谱 GLM Coding Plan 抢购脚本 (v7 - 自动出码版)
 *
 * 流程:
 *   1. 启动 ticket 服务 + 自动打开浏览器（server 直接返回验证码页面）
 *   2. 浏览器自动出码 → ticket 入共享池
 *   3. 脚本轮询全部方案库存（无验证码）
 *   4. 哪个有货就下哪个（优先级见 core/constants.ts PRODUCTS）
 *   5. 并发用全部 ticket 同时打 pay/preview → 谁先拿到 bizId 就用谁下单
 *
 * 用法: npm start
 *
 * 架构：本文件只含 main() 主流程编排。
 *       业务逻辑在 core/api.ts，基础设施在 core/http-client.ts，
 *       常量与横幅在 core/constants.ts，HTTP 服务在 server/ticket-server.ts。
 */

import { CONFIG, printBanner } from './core/constants.js';
import { log, setLogSink } from './core/http-client.js';
import { checkAllStock, placeOrder, verifyAuth, waitForTickets } from './core/api.js';
import {
  startServer, openBrowser, setPhase, shiftTicket, poolSize,
  appendLog, setLastStock, recordOrder, isPaused,
} from './server/ticket-server.js';

// ===== 主流程 =====
async function main(): Promise<void> {
  printBanner();

  // 1. 启动 ticket 服务 + 打开浏览器
  startServer();
  setLogSink(appendLog); // 注入日志转发：之后所有 log() 调用自动进浏览器监控面板
  openBrowser();
  setPhase('collecting', '等待拖滑块');
  console.log('');
  console.log('📌 操作：浏览器已自动打开 http://localhost:3737/');
  console.log('   在页面里点「⚡ 自动循环出码」');
  console.log('   拖完一个滑块会自动入池，脚本会持续监控库存');
  console.log('   抢到或抢购结束会自动通知浏览器停止');
  console.log('');

  // 2. 验证登录（不等 ticket，先验 token）
  if (!(await verifyAuth())) {
    setPhase('failed', '登录失效');
    log('❌ 登录失效，请检查 config.ts 的 AUTH_TOKEN');
    log('   服务保持运行，修复 token 后重启脚本');
    return;
  }
  log('✅ 登录有效');

  // 3. 等首批 ticket（至少 1 个）入池
  await waitForTickets(poolSize, 1);

  // 4. 进入抢购循环：库存监控 + 下单
  setPhase('sniping', `池子 ${poolSize()} 个 ticket`);
  let checkCount = 0;
  let ordered = false;
  log('🔄 开始监控全部方案库存（200ms/次，Ctrl+C 停止）...');

  while (!ordered) {
    // 暂停检查：被浏览器暂停时阻塞在这里，不查询不下单
    if (isPaused()) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    checkCount++;
    try {
      const stock = await checkAllStock(CONFIG.billingCycle, CONFIG.autoRenew);

      if (stock.ok) {
        // 检查哪些方案有库存
        const available = stock.products
          .filter((p) => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
          .sort((a, b) => a.priority - b.priority);

        // 显示各方案状态
        const statusLine = stock.products
          .map((p) => {
            if (!p.apiData) return `${p.name}:?`;
            if (p.apiData.soldOut) return `${p.name}:🟡`;
            if (p.apiData.forbidden) return `${p.name}:🔴`;
            return `${p.name}:🟢`;
          })
          .join(' ');
        log(`${statusLine} | 池:${poolSize()} | #${checkCount}`);

        // 上报库存快照到监控面板
        setLastStock(stock.products, checkCount);

        if (available.length > 0) {
          const target = available[0]!;
          log(`🎉🎉🎉 ${target.name} 有库存！#${checkCount}`);

          // 池子空了就等新 ticket
          if (poolSize() === 0) {
            log('⏳ 池子暂时空了，等待新 ticket 入池...');
            await waitForTickets(poolSize, 1);
          }

          // 立即下单（注入 ticket 池操作，解耦业务层与服务层）
          const result = await placeOrder(stock.products, { shiftTicket, poolSize });

          // 上报下单结果到监控面板
          recordOrder(result);

          if ('success' in result) {
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
              await waitForTickets(poolSize, 1);
              setPhase('sniping', `池子 ${poolSize()} 个 ticket`);
            }
          }
        }
      } else {
        // 查询失败（555 限流等）
        log(`🔴${stock.reason} | #${checkCount}`);
      }
    } catch (e) {
      log(`⚠️ 查询异常: ${(e as Error).message}`);
    }

    if (!ordered) {
      await new Promise((r) => setTimeout(r, CONFIG.checkInterval * 1000));
      await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 50)));
    }
  }

  if (!ordered) {
    setPhase('failed', '异常退出');
    log('❌ 脚本已停止（未下单）');
  }
}

main().catch((e: Error) => {
  setPhase('failed', e.message);
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
