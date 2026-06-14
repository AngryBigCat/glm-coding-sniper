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

## 操作步骤

1. **9:55** 启动脚本：`node glm-sniper-remote.mjs`
2. **9:58** 双击 `captcha-helper.html` → 点「批量出码」→ 拖 3 个滑块 → 一键复制
3. 在终端粘贴凭证（每行一组 `ticket randstr`），按 `Ctrl+Z` 结束
4. **10:00** 脚本自动秒杀（9 个套餐按优先级抢，哪个有货下哪个）
5. 出支付链接后扫码付款

## 配置说明

编辑 `glm-sniper-remote.mjs` 顶部的 `CONFIG`：

```js
const CONFIG = {
  billingCycle: 'month',  // batch-preview 查询用（服务器会返回全部商品，含季付/年付）
  autoRenew: true,
  checkInterval: 0.2,     // 轮询间隔(秒)
  payType: 'WE_CHAT',     // WE_CHAT | ALI
};
```

监控商品在 `PRODUCTS` 数组中定义，按 `priority` 字段决定抢购优先级。

## 套餐

监控全部 9 个套餐（月付 + 季付 + 年付），抢购时按优先级选第一个有货的下单：

| 优先级 | 套餐 | ProductId | 计费周期 | 价格 |
|--------|------|-----------|----------|------|
| 1 | Lite 月付 | product-02434c | month | ¥49/月 |
| 2 | Lite 季付 | product-b8ea38 | quarter | ¥132.3/季 |
| 3 | Pro 月付 | product-1df3e1 | month | ¥149/月 |
| 4 | Pro 季付 | product-fef82f | quarter | ¥402.3/季 |
| 5 | Max 月付 | product-2fc421 | month | ¥469/月 |
| 6 | Max 季付 | product-5d3a03 | quarter | ¥1266.3/季 |
| 7 | Lite 年付 | product-70a804 | annual | ¥470.4/年 |
| 8 | Pro 年付 | product-5643e6 | annual | ¥1430.4/年 |
| 9 | Max 年付 | product-d46f8b | annual | ¥4502.4/年 |

优先级顺序：Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年

## 抢购流程

脚本启动后的执行流程：

1. **输入凭证** — 粘贴 `captcha-helper.html` 生成的 ticket + randstr（每行一组），存入 ticket 队列
2. **验证登录** — 调 `isLimitBuy` 接口校验 token
3. **轮询库存**（每 200ms）— 调 `batch-preview`（不消耗 ticket），一次返回全部 9 个商品状态
4. **发现可买商品** — 按 priority 排序，选第一个非售罄/非禁购的商品
5. **并发下单** — 用全部 ticket 同时调 `pay/preview`（每个消耗 1 个 ticket），第一个返回 bizId 的胜出
6. **生成支付链接** — 调 `create-sign`（不消耗 ticket），输出扫码支付链接

## 提示

- 每个 ticket 有效期约 3-5 分钟，建议准备 5-15 个备用
- 抢购前先用 `node test_rate_limit.mjs` 测当前网络的 555 限流情况
- 填好 token 后用 `node test_connectivity.mjs` 验证是否生效
