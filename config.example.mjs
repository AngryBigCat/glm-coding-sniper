// GLM Coding Plan 抢购脚本配置
// 复制为 config.mjs 并填入你的 token

export const AUTH_TOKEN = 'YOUR_TOKEN_HERE';
export const CUSTOMER_ID = 'YOUR_CUSTOMER_ID';

// 获取新 token 的方法：
// 浏览器打开 https://www.bigmodel.cn/glm-coding
// 按 F12 → Console 运行：
// document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]
