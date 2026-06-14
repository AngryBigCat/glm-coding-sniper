/**
 * 常量与配置 — 纯数据模块，无副作用，不依赖 config
 *
 * 依赖方向：被 http-client / api / main 引用
 * 自身依赖：仅 types.js（类型）
 */

import type { BillingCycle, PayType, Product } from './types.js';

// ===== 运行时配置 =====
export interface AppConfig {
  billingCycle: BillingCycle;
  autoRenew: boolean;
  checkInterval: number; // 轮询间隔(秒)
  payType: PayType;
}

export const CONFIG: AppConfig = {
  billingCycle: 'month', // batch-preview 查询用（服务器会返回全部商品，含季付/年付）
  autoRenew: true,
  checkInterval: 0.2,
  payType: 'WE_CHAT',
};

// ===== 监控商品（月付 + 季付 + 年付）=====
// cycle 是下单 pay/preview 需要的 billingCycle 值（月付=month, 季付=quarter, 年付=annual）
// priority 抢购优先级：Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年
export const PRODUCTS: Product[] = [
  { id: 'product-02434c', name: 'Lite月付', cycle: 'month',   price: '¥49/月',     priority: 1 },
  { id: 'product-b8ea38', name: 'Lite季付', cycle: 'quarter', price: '¥132.3/季',  priority: 2 },
  { id: 'product-1df3e1', name: 'Pro月付',  cycle: 'month',   price: '¥149/月',    priority: 3 },
  { id: 'product-fef82f', name: 'Pro季付',  cycle: 'quarter', price: '¥402.3/季',  priority: 4 },
  { id: 'product-2fc421', name: 'Max月付',  cycle: 'month',   price: '¥469/月',    priority: 5 },
  { id: 'product-5d3a03', name: 'Max季付',  cycle: 'quarter', price: '¥1266.3/季', priority: 6 },
  { id: 'product-70a804', name: 'Lite年付', cycle: 'annual',  price: '¥470.4/年',   priority: 7 },
  { id: 'product-5643e6', name: 'Pro年付',  cycle: 'annual',  price: '¥1430.4/年',  priority: 8 },
  { id: 'product-d46f8b', name: 'Max年付',  cycle: 'annual',  price: '¥4502.4/年',  priority: 9 },
];

// ===== 静态请求头（不含 authorization，token 由 http-client 动态注入）=====
export const STATIC_HEADERS: Record<string, string> = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh',
  'bigmodel-organization': 'org-2D97D0B3D47E441B89c56fE7f138ABBf',
  'bigmodel-project': 'proj_1Cd4b480482F4eEFbe43eB20E2Da5c18',
  origin: 'https://bigmodel.cn',
  referer: 'https://bigmodel.cn/glm-coding',
  'set-language': 'zh',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
};

// ===== 启动横幅（读 CONFIG 展示监控信息）=====
export function printBanner(): void {
  console.log('='.repeat(60));
  console.log('GLM Coding Plan 抢购脚本 v7 — 自动出码版');
  console.log('监控: Lite月¥49 | Lite季¥132.3 | Pro月¥149 | Pro季¥402.3 | Max月¥469 | Max季¥1266.3 | Lite年¥470.4 | Pro年¥1430.4 | Max年¥4502.4');
  console.log('策略: 哪个有货下哪个，优先级 Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年');
  console.log(`支付: ${CONFIG.payType === 'WE_CHAT' ? '微信' : '支付宝'}`);
  console.log('='.repeat(60));
  console.log('');
}
