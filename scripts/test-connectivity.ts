// 连通性测试 — 不消耗 ticket，仅验证脚本能否访问 bigmodel.cn
// 用 batch-preview 接口（空 ticket）探测，失败/401 也属正常（说明只是 token 无效）

import https from 'node:https';
import { AUTH_TOKEN } from '../src/config.js';

interface ProbeResult {
  status?: number;
  elapsed: number;
  body?: { code?: number; msg?: string; [k: string]: unknown } | { parseError: true; raw: string };
  error?: string;
}

function api(path: string, method: 'GET' | 'POST' = 'GET', body: Record<string, unknown> | null = null): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
    const headers: Record<string, string> = {
      'accept': '*/*',
      'authorization': AUTH_TOKEN,
      'bigmodel-organization': 'org-2D97D0B3D47E441B89c56fE7f138ABBf',
      'bigmodel-project': 'proj_1Cd4b480482F4eEFbe43eB20E2Da5c18',
      'origin': 'https://bigmodel.cn',
      'referer': 'https://bigmodel.cn/glm-coding',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    };
    let bs: string | null = null;
    if (body) {
      bs = JSON.stringify(body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(bs).toString();
    }
    const t0 = Date.now();
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers, timeout: 15000 },
      (res) => {
        let d = '';
        res.on('data', (c: Buffer) => (d += c.toString()));
        res.on('end', () => {
          const elapsed = Date.now() - t0;
          let parsed: ProbeResult['body'];
          try {
            parsed = JSON.parse(d);
          } catch {
            parsed = { parseError: true, raw: d.slice(0, 200) };
          }
          resolve({ status: res.statusCode ?? 0, elapsed, body: parsed });
        });
      },
    );
    req.on('error', (e: Error) => resolve({ error: e.message, elapsed: Date.now() - t0 }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', elapsed: 15000 }); });
    if (bs) req.write(bs);
    req.end();
  });
}

console.log('='.repeat(55));
console.log('🔌 连通性测试 (不消耗 ticket)');
console.log('='.repeat(55));
console.log('');

// 1. 最简单的连通性 — 不带 token
console.log('【1】不带 token 访问首页...');
const t1 = await api('/glm-coding', 'GET');
console.log(`   HTTP ${t1.status} | ${t1.elapsed}ms | ${t1.error || (typeof t1.body === 'string' ? '(HTML 页面)' : JSON.stringify(t1.body).slice(0, 80))}`);

// 2. isLimitBuy（需要 token）
console.log('\n【2】isLimitBuy 接口（验证 token）...');
const t2 = await api('/api/biz/product/isLimitBuy', 'GET');
console.log(`   HTTP ${t2.status} | ${t2.elapsed}ms`);
console.log(`   响应: ${JSON.stringify(t2.body).slice(0, 200)}`);
if (t2.body && typeof t2.body === 'object' && 'code' in t2.body && t2.body.code === 200) {
  console.log('   ✅ TOKEN 有效！');
} else if (t2.status === 401 || (t2.body && typeof t2.body === 'object' && 'code' in t2.body && t2.body.code === 401)) {
  console.log('   ⚠️  TOKEN 无效或已过期（预期，因为是占位 token）');
}

// 3. batch-preview（不消耗 ticket，空 ticket 参数）
console.log('\n【3】batch-preview 接口（空 ticket，查全部库存）...');
const t3 = await api('/api/biz/pay/batch-preview', 'POST', {
  productId: 'product-02434c',
  billingCycle: 'month',
  autoRenew: true,
  ticket: '',
  randstr: '',
});
console.log(`   HTTP ${t3.status} | ${t3.elapsed}ms`);
console.log(`   响应: ${JSON.stringify(t3.body).slice(0, 400)}`);

console.log('\n' + '='.repeat(55));
console.log('📋 诊断结论');
console.log('='.repeat(55));
if (t1.status && t1.status >= 200 && t1.status < 500) {
  console.log('✅ 网络可达 bigmodel.cn，脚本能正常工作');
} else {
  console.log('❌ 无法访问 bigmodel.cn — 检查网络');
}
if (t2.body && typeof t2.body === 'object' && 'code' in t2.body && t2.body.code === 200) {
  console.log('✅ Token 有效，可正常抢购');
} else {
  console.log('⚠️  Token 无效 — 这只是测试脚本，实际抢购前请在 src/config.ts 填入真实 token');
}
