import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const posts = [];
page.on('request', r => {
  if (r.method() === 'POST' || r.method() === 'GET') {
    const url = r.url();
    if (url.includes('/api/biz/') && !url.includes('tracking') && !url.includes('qiyukf')) {
      posts.push({
        url: url.slice(0, 300),
        method: r.method(),
        postData: r.postData()?.slice(0, 500),
        type: r.resourceType(),
      });
    }
  }
});

// 找 JS 文件中的下单 API
const jsApis = [];
page.on('response', async r => {
  const url = r.url();
  const ct = r.headers()['content-type'] || '';
  if (ct.includes('javascript') && url.includes('bigmodel.cn/js/')) {
    const body = await r.text().catch(() => '');
    if (body.includes('subscri') || body.includes('pay') || body.includes('order') || body.includes('create')) {
      jsApis.push(url);
    }
  }
});

console.log('Loading page...');
await page.goto('https://bigmodel.cn/glm-coding', {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
await page.waitForTimeout(6000);

// 点击"即刻订阅"
console.log('\n=== Clicking 即刻订阅 ===');
const btn = await page.$('button:has-text("即刻订阅")');
if (btn) {
  posts.length = 0;
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => null),
    btn.click(),
  ]);
  await page.waitForTimeout(5000);
}

console.log('\n=== API requests ===');
for (const r of posts) {
  console.log(`${r.method} ${r.url}`);
  if (r.postData) console.log(`  Body: ${r.postData.slice(0, 300)}`);
}

console.log('\n=== Current URL ===');
console.log(page.url());

// 获取页面内容
const text = await page.innerText('body').catch(() => '');
console.log('\n=== Page text (first 1500) ===');
console.log(text.slice(0, 1500));

// 找 JS 中的订阅 API
console.log('\n=== Searching JS for subscribe/order APIs ===');
const jsUrls = [
  'https://bigmodel.cn/js/vendors~ClaudeCode~SubscribePay~subscribe-overview.97f659be.js',
  'https://bigmodel.cn/js/ClaudeCode~subscribe-overview.d47dc8fc.js',
  'https://bigmodel.cn/js/ClaudeCode.2211999c.js',
  'https://bigmodel.cn/js/app.2fa5a224.js',
];

for (const jsUrl of jsUrls) {
  try {
    const resp = await page.evaluate(async (url) => {
      const r = await fetch(url);
      return r.ok ? await r.text() : null;
    }, jsUrl);

    if (!resp) continue;

    // 搜索 API 路径
    const apiMatches = [...resp.matchAll(/["'](\/api\/biz\/[^"']+)["']/g)];
    if (apiMatches.length > 0) {
      console.log(`\n${jsUrl.slice(-60)}`);
      for (const m of apiMatches) console.log(`  ${m[1]}`);
    }

    // 搜索 createOrder, subscribe, pay 等
    for (const kw of ['createOrder', 'createSubscri', 'payOrder', 'submitOrder', 'subscribePay']) {
      const idx = resp.indexOf(kw);
      if (idx >= 0) {
        console.log(`\n🎯 "${kw}" in ${jsUrl.slice(-60)}`);
        console.log(`  ...${resp.slice(idx, idx + 200)}...`);
      }
    }
  } catch {}
}

await browser.close();
