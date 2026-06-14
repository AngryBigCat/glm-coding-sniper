import { chromium } from 'playwright';

import { AUTH_TOKEN } from './config.mjs';
const AUTH = AUTH_TOKEN;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// First navigate to set up the domain context
await page.goto('https://bigmodel.cn/glm-coding', { waitUntil: 'domcontentloaded', timeout: 15000 });
await page.waitForTimeout(2000);

// Set cookie via JavaScript in the page context
await page.evaluate((token) => {
  document.cookie = `bigmodel_token_production=${token}; path=/; domain=.bigmodel.cn`;
}, AUTH);

// Wait a moment for cookie to be set
await page.waitForTimeout(1000);

// Make API calls using page's fetch
console.log('=== isLimitBuy ===');
const result1 = await page.evaluate(async () => {
  const resp = await fetch('https://bigmodel.cn/api/biz/product/isLimitBuy', {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Authorization': document.cookie.split('; ').find(c => c.startsWith('bigmodel_token_production='))?.split('=')[1] || ''
    }
  });
  return resp.json();
});
console.log(JSON.stringify(result1, null, 2));

console.log('\n=== productInfo ===');
const result2 = await page.evaluate(async () => {
  const resp = await fetch('https://bigmodel.cn/api/biz/product/info?productId=product-003', {
    method: 'GET',
    credentials: 'include',
    headers: {
      'Authorization': document.cookie.split('; ').find(c => c.startsWith('bigmodel_token_production='))?.split('=')[1] || ''
    }
  });
  return resp.json();
});
console.log(JSON.stringify(result2, null, 2));

await browser.close();
