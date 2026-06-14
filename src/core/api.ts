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

import { CONFIG, PRODUCTS } from './constants.js';
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

  // ===== 下单（串行：每次取 1 个 ticket 冲，失败再取下一个，成功即停）=====
  async function placeOrder(productInfo: StockProduct[], deps: OrderDeps): Promise<OrderResult> {
    const available = productInfo
      .filter((p) => p.apiData && !p.apiData.soldOut && !p.apiData.forbidden)
      .sort((a, b) => a.priority - b.priority);

    if (available.length === 0) return { error: '无可买方案' };
    if (deps.poolSize() === 0) return { error: 'ticket 池为空' };

    const target = available[0]!;
    const { id: productId, name } = target;
    const poolBefore = deps.poolSize();
    log(`🎯 下单 ${name} (${productId})，串行冲票（池子 ${poolBefore} 个）...`);

    let attempt = 0;
    let lastError = '未知错误';

    while (deps.poolSize() > 0) {
      attempt++;
      const cred = deps.shiftTicket();
      if (!cred) break;

      const result = await trySingleOrder(productId, name, cred, attempt);

      // 成功：立即返回
      if ('success' in result) return result;

      // 记录失败原因，继续取下一个 ticket
      lastError = result.error;

      // 售罄：不用再试了（这批库存已没）
      if (lastError === '下单时已售罄') {
        log('🛑 已售罄，停止冲票');
        break;
      }
    }

    return { error: `本批尝试 ${attempt} 个 ticket 均失败，最后原因: ${lastError}` };
  }

  // ===== 单次下单尝试（1 个 ticket）=====
  async function trySingleOrder(
    productId: string,
    productName: string,
    cred: TicketCred,
    attempt: number,
  ): Promise<OrderResult> {
    const { ticket, randstr } = cred;
    let res: ApiResponse<PayPreviewData> | ApiParseError;
    try {
      res = await client<ApiResponse<PayPreviewData>>('POST', '/api/biz/pay/preview', {
        productId,
        ticket,
        randstr,
      });
    } catch (err) {
      log(`  [票#${attempt}] ❌ 网络错误: ${(err as Error).message}`);
      return { error: `网络错误: ${(err as Error).message}` };
    }

    // 解析失败
    if ('parseError' in res) {
      log(`  [票#${attempt}] ❌ 响应解析失败`);
      return { error: '响应解析失败' };
    }

    // 打印结果
    const d = res.data;
    log(`  [票#${attempt}] code:${res.code} ${d?.bizId ? '✅ bizId:' + d.bizId : d?.soldOut ? '售罄' : res.msg}`);

    // 没有 bizId 或 soldOut → 失败（555/限流/其他）
    if (res.code !== 200 || !d?.bizId) {
      return { error: d?.soldOut ? '下单时已售罄' : `code:${res.code} ${res.msg || ''}` };
    }

    // 命中！create-sign → 支付链接
    const { bizId, payAmount } = d;
    log(`🏆 票#${attempt} 命中！bizId: ${bizId}, 金额: ¥${payAmount}`);
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
