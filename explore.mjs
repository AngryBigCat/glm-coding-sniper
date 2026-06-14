import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 拦截所有网络请求
const requests = [];
const jsonApis = [];

page.on('request', r => {
  const url = r.url();
  const type = r.resourceType();
  if (url.includes('bigmodel') || url.includes('glm') || url.includes('coding') || url.includes('plan') || url.includes('subscri')) {
    requests.push({ url: url.slice(0, 250), method: r.method(), type });
  }
});

page.on('response', async r => {
  const url = r.url();
  const ct = r.headers()['content-type'] || '';
  if (ct.includes('json') && !url.includes('analytics') && !url.includes('tracking') && !url.includes('stat')) {
    try {
      const body = await r.text().catch(() => '');
      if (body.length > 10 && body.length < 5000) {
        jsonApis.push({ url: url.slice(0, 250), status: r.status(), body: body.slice(0, 500) });
      }
    } catch {}
  }
});

console.log('Loading glm-coding page...');
await page.goto('https://bigmodel.cn/glm-coding', {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
await page.waitForTimeout(8000);

console.log('\n=== JSON API Responses ===');
for (const api of jsonApis) {
  console.log(`\n[${api.status}] ${api.url}`);
  console.log(api.body);
  console.log('---');
}

console.log('\n=== Coding-related requests ===');
for (const r of requests) {
  console.log(`${r.method} [${r.type}] ${r.url}`);
}

// 获取页面文本
console.log('\n=== Page text (first 2000 chars) ===');
const text = await page.innerText('body').catch(() => '');
console.log(text.slice(0, 2000));

// 找按钮
console.log('\n=== Buttons with "购买"/"订阅"/"开通" ===');
const btns = await page.$$eval('button, [role="button"]', els =>
  els.map(e => ({ text: e.innerText?.trim(), tag: e.tagName })).filter(e => e.text && (e.text.includes('购买') || e.text.includes('订阅') || e.text.includes('开通') || e.text.includes('售罄')))
);
console.log(btns);

await browser.close();
