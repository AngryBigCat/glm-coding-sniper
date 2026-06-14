import { AUTH_TOKEN } from './config.mjs';
import https from 'https';

const HEADERS = {
  'accept': '*/*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'authorization': AUTH_TOKEN,
  'origin': 'https://www.bigmodel.cn',
  'referer': 'https://www.bigmodel.cn/glm-coding',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
};

function apiCall(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path.startsWith('http') ? path : `https://bigmodel.cn${path}`);
    const headers = { ...HEADERS };
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers,
      timeout: 10000,
    };

    if (body) {
      const bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: 'parse_error', raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  console.log('=== Step 1: pay/preview ===');
  const preview = await apiCall('/api/biz/pay/preview', 'POST', {
    productId: 'product-003',
    billingCycle: 'month',
    autoRenew: true,
  });
  console.log(JSON.stringify(preview, null, 2));

  console.log('\n=== Step 2: createPreOrder with full params ===');
  // Based on error: need payPrice, num, isMobile, channelCode
  const preOrder = await apiCall('/api/biz/product/createPreOrder', 'POST', {
    productId: 'product-003',
    billingCycle: 'month',
    autoRenew: true,
    num: 1,
    payPrice: 4900, // 49.00 in cents
    isMobile: false,
    channelCode: 'alipay',
  });
  console.log(JSON.stringify(preOrder, null, 2));
}

main().catch(console.error);
