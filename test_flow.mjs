import { AUTH_TOKEN } from './config.mjs';
import https from 'https';

const H = {
  'accept': '*/*',
  'authorization': AUTH_TOKEN,
  'origin': 'https://www.bigmodel.cn',
  'referer': 'https://www.bigmodel.cn/glm-coding',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function api(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
    const headers = { ...H };
    if (body) {
      const b = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(b);
    }
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, method, headers, timeout: 10000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d.slice(0, 500) }); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  // Try create-sign with proper params
  const bodies = [
    // Lite 月付 ¥49
    {
      productId: 'product-02434c',
      billingCycle: 'month',
      autoRenew: true,
      payPrice: 49,
      num: 1,
      isMobile: false,
      channelCode: 'alipay',
    },
    // Try without payPrice
    {
      productId: 'product-02434c',
      billingCycle: 'month',
      autoRenew: true,
      num: 1,
      isMobile: false,
      channelCode: 'alipay',
    },
    // Try with amount
    {
      productId: 'product-02434c',
      billingCycle: 'month',
      autoRenew: true,
      payPrice: 49,
      amount: 49,
      num: 1,
      isMobile: false,
      channelCode: 'alipay',
    },
    // Also try product-003
    {
      productId: 'product-003',
      billingCycle: 'month',
      autoRenew: true,
      payPrice: 4900,
      num: 1,
      isMobile: false,
      channelCode: 'alipay',
    },
  ];

  for (const body of bodies) {
    console.log(`\n=== create-sign: ${JSON.stringify(body)} ===`);
    const result = await api('/api/biz/pay/create-sign', 'POST', body);
    console.log(`结果: ${JSON.stringify(result)}`);
  }
}

main().catch(console.error);
