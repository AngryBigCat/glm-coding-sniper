/**
 * 业务逻辑层 — bigmodel.cn 的库存查询与下单
 *
 * 依赖方向：被 sniper.ts 引用
 * 自身依赖：http-client（api/log）、constants（PRODUCTS/CONFIG/REFER_1090）、config（CUSTOMER_ID）、types
 *
 * 关键设计：placeOrder 通过 deps 参数接收 ticket 池操作，
 *           不直接 import ticket-server，业务层与服务层解耦。
 */

import { CUSTOMER_ID } from '../config.js';
import { CONFIG, PRODUCTS, REFER_1090 } from './constants.js';
import { api, log } from './http-client.js';
import type {
  ApiResponse,
  ApiParseError,
  BatchPreviewData,
  BillingCycle,
  CreateSignData,
  OrderResult,
  PayPreviewData,
  StockProduct,
  StockResult,
  TicketCred,
} from './types.js';

// ===== ticket 池操作的注入接口（解耦业务层与服务层）=====
export interface OrderDeps {
  shiftTicket: () => TicketCred | undefined;
  poolSize: () => number;
}

// ===== 验证登录 =====
export async function verifyAuth(): Promise<boolean> {
  const r = await api<ApiResponse>('GET', '/api/biz/product/isLimitBuy');
  if ('code' in r && r.code === 200) return true;
  log(`❌ 登录失效: ${JSON.stringify(r)}`);
  return false;
}

// ===== 查库存 - 返回全部方案的库存状态 =====
export async function checkAllStock(cycle: BillingCycle, renew: boolean): Promise<StockResult> {
  const r = await api<ApiResponse<BatchPreviewData>>('POST', '/api/biz/pay/batch-preview', {
    productId: 'product-02434c',
    billingCycle: cycle,
    autoRenew: renew,
    ticket: '',
    randstr: '',
  });

  if ('parseError' in r) {
    return { ok: false, reason: 'parseError', raw: { code: -1 } };
  }
  if (r.code !== 200) {
    return { ok: false, reason: r.msg || `http_${r.code}`, raw: r };
  }

  // 从返回列表中匹配已知方案
  const allProducts = r.data?.productList ?? [];
  const matched: StockProduct[] = PRODUCTS.map((p) => {
    const apiP = allProducts.find((a) => a.productId === p.id) ?? null;
    return { ...p, apiData: apiP };
  });
  return { ok: true, products: matched, raw: r };
}

// ===== 下单（从注入的池操作取全部 ticket 并发冲）=====
export async function placeOrder(productInfo: StockProduct[], deps: OrderDeps): Promise<OrderResult> {
  // 按优先级选可买的
  const available = productInfo
    .filter((p) => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
    .sort((a, b) => a.priority - b.priority);

  if (available.length === 0) return { error: '无可买方案' };
  if (deps.poolSize() === 0) return { error: 'ticket 池为空' };

  // 把池子里全部 ticket 取出一次性并发冲（shiftTicket 可能返回 undefined，需过滤）
  const tickets: TicketCred[] = [];
  while (deps.poolSize() > 0) {
    const t = deps.shiftTicket();
    if (t) tickets.push(t);
  }

  const target = available[0]!;
  const { id: productId, name, cycle } = target;
  log(`🎯 下单 ${name} (${productId}, cycle=${cycle})，并发 ${tickets.length} 个 ticket...`);
  return await concurrentPlaceOrder(productId, name, cycle, tickets);
}

// ===== 并发下单内部类型（仅本模块使用）=====
interface PreviewAttempt {
  ticketIdx: number;
  success: boolean;
  result?: ApiResponse<PayPreviewData> | ApiParseError;
  error?: string;
}

// ===== 并发下单（多 ticket 同时冲）=====
async function concurrentPlaceOrder(
  productId: string,
  productName: string,
  billingCycle: BillingCycle,
  tickets: TicketCred[],
): Promise<OrderResult> {
  // 同时发所有 ticket 的 pay/preview 请求
  const promises = tickets.map((cred, i) => {
    const { ticket, randstr } = cred;
    return api<ApiResponse<PayPreviewData>>('POST', `/api/biz/pay/preview?refer__1090=${REFER_1090}`, {
      productId,
      billingCycle,
      ticket,
      randstr,
    })
      .then((res): PreviewAttempt => ({ ticketIdx: i, success: true, result: res }))
      .catch((err: Error): PreviewAttempt => ({ ticketIdx: i, success: false, error: err.message }));
  });

  log(`🚀 并发请求已发出，等待返回...`);
  const results = await Promise.all(promises);

  // 找第一个成功的（code:200 且有 bizId）
  let winner: PreviewAttempt | null = null;
  for (const r of results) {
    if (
      r.success &&
      r.result &&
      !('parseError' in r.result) &&
      r.result.code === 200 &&
      r.result.data?.bizId
    ) {
      winner = r;
      break;
    }
  }

  // 打印所有结果（方便调试）
  for (const r of results) {
    if (r.success && r.result && !('parseError' in r.result)) {
      const d = r.result;
      log(
        `  [票#${r.ticketIdx + 1}] code:${d.code} ${d.data?.bizId ? '✅ bizId:' + d.data.bizId : d.data?.soldOut ? '售罄' : d.msg}`,
      );
    } else if (!r.success) {
      log(`  [票#${r.ticketIdx + 1}] ❌ ${r.error}`);
    }
  }

  if (!winner || !winner.result || 'parseError' in winner.result) {
    return { error: `本批 ${results.length} 个 ticket 全部失败` };
  }

  const { bizId, soldOut, payAmount } = winner.result.data!;
  if (soldOut) return { error: '下单时已售罄' };
  log(`🏆 票#${winner.ticketIdx + 1} 命中！bizId: ${bizId}, 金额: ¥${payAmount}`);

  // create-sign → 支付链接（串行，只有一次请求，不会消耗 ticket）
  log('▶️ create-sign...');
  const sign = await api<ApiResponse<CreateSignData>>('POST', `/api/biz/pay/create-sign`, {
    payType: CONFIG.payType,
    productId,
    customerId: CUSTOMER_ID,
    bizId: bizId!,
  });
  log(`   → ${JSON.stringify(sign).slice(0, 400)}`);

  if (!('parseError' in sign) && sign.code === 200 && sign.data) {
    return { success: true, productName, bizId: bizId!, payAmount: payAmount!, data: sign.data };
  }
  return { error: `create-sign: ${(!('parseError' in sign) && sign.msg) || JSON.stringify(sign)}` };
}
