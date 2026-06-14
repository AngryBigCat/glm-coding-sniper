# GLM Coding Plan 抢购脚本

智谱 GLM Coding Plan 订阅抢购工具。

## 使用方法

1. 复制 `config.example.mjs` 为 `config.mjs`
2. 填入你的 AUTH_TOKEN 和 CUSTOMER_ID（从浏览器获取）
3. 运行脚本

```bash
node glm-sniper-remote.mjs
```

## 获取 Token

1. 浏览器打开 https://www.bigmodel.cn/glm-coding 并登录
2. 按 F12 → Console，运行：
   ```js
   document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]
   ```
3. 复制输出填到 `config.mjs`

## 文件说明

| 文件 | 说明 |
|------|------|
| `glm-sniper-remote.mjs` | **主脚本** — 轮询库存，有货立即并发冲票下单 |
| `captcha-helper.html` | 验证码生成器页面（批量出 3 个滑块验证） |
| `test_rate_limit.mjs` | 限流压力测试（不消耗 ticket，探测 555 阈值） |
| `test_connectivity.mjs` | 连通性诊断（验证 token 与网络） |
| `config.example.mjs` | 配置模板 |

## 抢购流程

1. **9:55** 启动脚本：`node glm-sniper-remote.mjs`
2. **9:58** 双击 `captcha-helper.html` → 点「批量出码」→ 拖 3 个滑块 → 一键复制
3. 在终端粘贴凭证（每行一组 `ticket randstr`），按 `Ctrl+Z` 结束
4. **10:00** 脚本自动秒杀（优先级 Lite > Pro > Max）
5. 出支付链接后扫码付款

## 配置说明

编辑 `glm-sniper-remote.mjs` 顶部的 `CONFIG`：

```js
const CONFIG = {
  billingCycle: 'month',
  autoRenew: true,
  checkInterval: 0.2,     // 轮询间隔(秒)
  payType: 'WE_CHAT',     // WE_CHAT | ALI
};
```

抢购优先级固定为 Lite > Pro > Max，哪个有货下哪个。

## 套餐

| 套餐 | ProductId | 价格 |
|------|-----------|------|
| Lite | product-02434c | ¥49/月 |
| Pro  | product-1df3e1 | ¥149/月 |
| Max  | product-2fc421 | ¥469/月 |

## 提示

- 每个 ticket 有效期约 3-5 分钟，建议准备 5-15 个备用
- 抢购前先用 `node test_rate_limit.mjs` 测当前网络的 555 限流情况
- 填好 token 后用 `node test_connectivity.mjs` 验证是否生效
