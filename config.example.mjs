// GLM Coding Plan 抢购脚本配置
// 复制为 config.mjs 并填入你的凭证

export const AUTH_TOKEN = 'YOUR_TOKEN_HERE';
export const CUSTOMER_ID = 'YOUR_CUSTOMER_ID';

// 获取 AUTH_TOKEN：
//   浏览器打开 https://www.bigmodel.cn/glm-coding 并登录
//   按 F12 → Console 运行：
//   document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]

// 获取 CUSTOMER_ID：
//   登录后访问 https://bigmodel.cn/coding-plan/personal/overview
//   F12 → Network 刷新页面，找请求里的 customerId 参数
//   或 F12 → Application → Local Storage 找 customerId 字段
