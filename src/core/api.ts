/**
 * 业务逻辑层 — bigmodel.cn 的库存查询与下单
 *
 * 依赖方向：被 main.ts 引用
 * 自身依赖：http-client（createApiClient/log 类型）、constants（PRODUCTS/CONFIG/REFER_1090）、types
 *
 * 设计：通过 createApi(client, customerId) 工厂创建，
 *       client 和 customerId 由 main.ts 注入，本模块不 import config。
 *       placeOrder 通过 OrderDeps 接收 ticket 池操作，与 server 层解耦。
 */

import { CONFIG, PRODUCTS, REFER_1090 } from './constants.js';
import type { ApiClient } from './http-client.js';
import { log } from './http-client.js';
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

// ===== 业务 API 对象（由 createApi 工厂创建）=====
export interface BusinessApi {
  verifyAuth: () => Promise<boolean>;
  checkAllStock: (cycle: BillingCycle, renew: boolean) => Promise<StockResult>;
  placeOrder: (productInfo: StockProduct[], deps: OrderDeps) => Promise<OrderResult>;
}

/**
 * 创建业务 API（注入 HTTP 客户端和 customerId）
 * 在 main.ts 调用一次，返回的对象包含所有业务方法
 */
export function createApi(client: ApiClient, customerId: string): BusinessApi {
  // ===== 验证登录 =====
  async function verifyAuth(): Promise<boolean> {
    const r = await client<ApiResponse>('GET', '/api/biz/product/isLimitBuy');
    if ('code' in r && r.code === 200) return true;
    log(`❌ 登录失效: ${JSON.stringify(r)}`);
    return false;
  }

  // ===== 查库存 - 返回全部方案的库存状态 =====
  async function checkAllStock(cycle: BillingCycle, renew: boolean): Promise<StockResult> {
    const r = await client<ApiResponse<BatchPreviewData>>('POST', '/api/biz/pay/batch-preview', {
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
  async function placeOrder(productInfo: StockProduct[], deps: OrderDeps): Promise<OrderResult> {
    const available = productInfo
      .filter((p) => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
      .sort((a, b) => a.priority - b.priority);

    if (available.length === 0) return { error: '无可买方案' };
    if (deps.poolSize() === 0) return { error: 'ticket 池为空' };

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
    const promises = tickets.map((cred, i) => {
      const { ticket, randstr } = cred;
      return client<ApiResponse<PayPreviewData>>('POST', `/api/biz/pay/preview?refer__1090=${REFER_1090}`, {
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

    // create-sign → 支付链接
    log('▶️ create-sign...');
    const sign = await client<ApiResponse<CreateSignData>>('POST', `/api/biz/pay/create-sign`, {
      payType: CONFIG.payType,
      productId,
      customerId,
      bizId: bizId!,
    });
    log(`   → ${JSON.stringify(sign).slice(0, 400)}`);

    if (!('parseError' in sign) && sign.code === 200 && sign.data) {
      return { success: true, productName, bizId: bizId!, payAmount: payAmount!, data: sign.data };
    }
    return { error: `create-sign: ${(!('parseError' in sign) && sign.msg) || JSON.stringify(sign)}` };
  }

  return { verifyAuth, checkAllStock, placeOrder };
}

// ===== 等待池子里至少有 minSize 个 ticket（独立于 client，用 log 即可）=====
export function waitForTickets(poolSize: () => number, minSize = 1): Promise<void> {
  return new Promise((resolve) => {
    if (poolSize() >= minSize) {
      resolve();
      return;
    }
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
