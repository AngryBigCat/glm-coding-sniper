import { chromium } from 'playwright';

import { AUTH_TOKEN } from './config.mjs';
const AUTH = AUTH_TOKEN;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addCookies([
  { name: 'bigmodel_token_production', value: AUTH, domain: '.bigmodel.cn', path: '/' },
]);
const page = await context.newPage();

// Make API calls
const apis = [
  { name: 'isLimitBuy', url: 'https://bigmodel.cn/api/biz/product/isLimitBuy' },
  { name: 'productInfo', url: 'https://bigmodel.cn/api/biz/product/info?productId=product-003' },
  { name: 'subscriptionList', url: 'https://bigmodel.cn/api/biz/subscription/list' },
];

for (const api of apis) {
  console.log(`\n=== ${api.name} ===`);
  const result = await page.evaluate(async (url) => {
    const resp = await fetch(url, { credentials: 'include' });
    return resp.json();
  }, api.url);
  console.log(JSON.stringify(result, null, 2));
}

await browser.close();
