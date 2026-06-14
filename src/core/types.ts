/**
 * 共享类型定义 — sniper.ts 和 ticket-server.ts 都从这里 import
 */

// ===== 基础字面量联合类型 =====

/** 抢购阶段（ticket-server 的 state.phase） */
export type Phase = 'idle' | 'collecting' | 'sniping' | 'done' | 'failed';

/** 计费周期：月付=month, 季付=quarter, 年付=annual */
export type BillingCycle = 'month' | 'quarter' | 'annual';

/** 支付方式 */
export type PayType = 'WE_CHAT' | 'ALI';

// ===== 核心数据结构 =====

/** 验证码凭证（生产者推送、消费者消费的单元） */
export interface TicketCred {
  ticket: string;
  randstr: string;
  ts?: number; // pushTicket 写入 Date.now()，消费时不关心
}

/** 监控的商品定义（PRODUCTS 数组元素） */
export interface Product {
  id: string; // 'product-02434c'
  name: string; // 'Lite月付'
  cycle: BillingCycle; // 下单时传给 pay/preview
  price: string; // '¥49/月'（展示用）
  priority: number; // 越小越优先
}

/** 商品 + 服务器返回的库存状态（checkAllStock 产物） */
export interface StockProduct extends Product {
  apiData: BatchPreviewProduct | null;
}

// ===== API 响应外层包装 =====

/** bigmodel.cn 业务接口统一外层 */
export interface ApiResponse<T = unknown> {
  code: number; // 200 / 401 / 555 ...
  msg?: string;
  data?: T;
  success?: boolean;
}

/** JSON 解析失败的兜底结构 */
export interface ApiParseError {
  parseError: true;
  raw: string;
}

// ===== 各接口的 data 结构（从代码反推） =====

/** batch-preview 返回的单个商品状态 */
export interface BatchPreviewProduct {
  productId: string;
  soldOut?: boolean;
  forbidden?: boolean;
  payAmount?: number;
  stock?: number;
  [k: string]: unknown; // 兜底：服务器可能返回更多字段
}

/** batch-preview 的 data */
export interface BatchPreviewData {
  productList: BatchPreviewProduct[];
}

/** pay/preview 的 data（下单关键返回） */
export interface PayPreviewData {
  bizId?: string; // 命中下单的关键字段
  soldOut?: boolean;
  payAmount?: number;
  [k: string]: unknown;
}

/** create-sign 的 data（支付链接） */
export interface CreateSignData {
  orderId?: string;
  sign?: string; // 支付链接 URL
  [k: string]: unknown;
}

// ===== 函数返回值联合类型 =====

/** checkAllStock 的返回：成功 | 失败 */
export interface CheckStockOk {
  ok: true;
  products: StockProduct[];
  raw: ApiResponse<BatchPreviewData>;
}

export interface CheckStockFail {
  ok: false;
  reason: string;
  raw: ApiResponse;
}

export type StockResult = CheckStockOk | CheckStockFail;

/** placeOrder 的返回：成功 | 失败 */
export interface OrderSuccess {
  success: true;
  productName: string;
  bizId: string;
  payAmount: number;
  data: CreateSignData;
}

export interface OrderError {
  error: string;
}

export type OrderResult = OrderSuccess | OrderError;

// ===== ticket-server 共享状态 =====

export interface ServerState {
  pool: TicketCred[];
  phase: Phase;
  message: string;
  totalProduced: number;
  totalConsumed: number;
  startedAt: number | null;
}

// ===== HTTP 接口响应类型（给浏览器看的） =====

/** GET /status 响应体 */
export interface StatusResponse {
  phase: Phase;
  message: string;
  poolSize: number;
  totalProduced: number;
  totalConsumed: number;
  startedAt: number | null;
}

/** POST /push 响应体 */
export interface PushResponse {
  ok: boolean;
  poolSize?: number;
  phase?: Phase;
  error?: string;
}
