import { chromium } from 'playwright';
import fs from 'fs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// 拦截所有 API 请求
const apiCalls = [];
page.on('request', r => {
  const url = r.url();
  if (url.includes('bigmodel.cn/api/')) {
    apiCalls.push({
      url: url.slice(0, 300),
      method: r.method(),
      postData: r.postData(),
      type: r.resourceType(),
    });
  }
});

// 拦截 API 响应
const apiResponses = [];
page.on('response', async r => {
  const url = r.url();
  const ct = r.headers()['content-type'] || '';
  if (url.includes('bigmodel.cn/api/') && ct.includes('json')) {
    try {
      const body = await r.text().catch(() => '');
      if (body.length > 10 && body.length < 3000) {
        apiResponses.push({
          url: url.slice(0, 300),
          status: r.status(),
          body: body.slice(0, 1500),
        });
      }
    } catch {}
  }
});

console.log('Loading page...');
await page.goto('https://bigmodel.cn/glm-coding', {
  waitUntil: 'domcontentloaded',
  timeout: 20000,
});
await page.waitForTimeout(6000);

// 保存页面初始 API 调用
const initialApiCalls = JSON.parse(JSON.stringify(apiCalls));
const initialApiResponses = JSON.parse(JSON.stringify(apiResponses));
console.log(`\nInitial: ${initialApiCalls.length} requests, ${initialApiResponses.length} responses`);

// 清空，只记录点击后的
apiCalls.length = 0;
apiResponses.length = 0;

// 点击"即刻订阅"
console.log('\n=== Clicking 即刻订阅 ===');
const btn = await page.$('button:has-text("即刻订阅")');
if (btn) {
  await btn.click();
  await page.waitForTimeout(6000);

  console.log('\n=== After click: API requests ===');
  for (const r of apiCalls) {
    console.log(`\n${r.method} ${r.url}`);
    if (r.postData) console.log(`  Body: ${r.postData.slice(0, 500)}`);
  }

  console.log('\n=== After click: API responses ===');
  for (const r of apiResponses) {
    console.log(`\n[${r.status}] ${r.url}`);
    console.log(r.body);
    console.log('---');
  }

  console.log('\n=== Current URL ===');
  console.log(page.url());

  // 检查页面变化
  const text = await page.innerText('body').catch(() => '');
  console.log('\n=== Body text first 1000 chars ===');
  console.log(text.slice(0, 1000));

  // 保存完整 HTML 用于分析
  const html = await page.content();
  fs.writeFileSync('./page_after_click.html', html);
  console.log('\n=== Full HTML saved to page_after_click.html ===');
} else {
  console.log('Button not found!');
  // 打印所有按钮
  const btns = await page.$$('button');
  for (const b of btns) {
    const t = await b.innerText().catch(() => '');
    console.log(`  Button: "${t}"`);
  }
}

await browser.close();
