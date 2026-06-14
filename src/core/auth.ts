/**
 * 认证工具 — 从 AUTH_TOKEN（JWT）解码用户信息
 *
 * 依赖方向：被 api.ts 引用
 * 自身依赖：无（纯函数，token 由调用方传入）
 */

/** JWT payload 结构 */
interface JwtPayload {
  customer_id?: string;
  user_id?: number;
  username?: string;
  [k: string]: unknown;
}

/** 解码 JWT payload（不验签，只读数据） */
function decodeJwt(authToken: string): JwtPayload {
  const parts = authToken.split('.');
  if (parts.length !== 3) throw new Error('AUTH_TOKEN 不是有效的 JWT 格式');
  const payload = JSON.parse(
    Buffer.from(parts[1]! + '==='.slice((parts[1]!.length + 3) % 4), 'base64').toString(),
  );
  return payload as JwtPayload;
}

/** 从 authToken 解码出 customerId */
export function getCustomerId(authToken: string): string {
  const id = decodeJwt(authToken).customer_id;
  if (!id) throw new Error('AUTH_TOKEN 的 JWT payload 里没有 customer_id 字段');
  return String(id);
}
