# GLM Coding Plan 抢购脚本

智谱 GLM Coding Plan 订阅抢购工具。

## 使用方法

```bash
# 1. 首次安装：创建配置文件
npm run setup

# 2. 编辑 src/config.ts，填入 AUTH_TOKEN 和 CUSTOMER_ID

# 3. 验证连通性（可选）
npm run test:connect

# 4. 启动抢购（会自动弹出浏览器）
npm start
```

脚本启动后：
- 自动打开浏览器（`public/captcha-helper.html`）
- 在浏览器里点「⚡ 自动循环出码」
- 拖完一个滑块，ticket 自动入池，页面自动弹下一个
- 抢到后脚本自动通知浏览器停止

## 命令说明

| 命令 | 说明 |
|------|------|
| `npm start` | 启动主抢购脚本（起服务 + 开浏览器 + 轮询下单） |
| `npm run setup` | 首次安装引导，创建 `src/config.ts` 配置文件 |
| `npm run test:connect` | 连通性诊断（验证 token 与网络，不消耗 ticket） |
| `npm run test:ratelimit` | 限流压力测试（探测 555 阈值，不消耗 ticket） |
| `npm run typecheck` | TypeScript 类型检查（不运行代码） |

项目使用 TypeScript，通过 `tsx` 直接运行（无需编译）。首次使用前运行 `npm install` 安装依赖。

## 工作原理

采用**生产者-消费者**架构，把「生成 ticket」和「消费 ticket」解耦：

```
┌─────────────────────┐       ┌──────────────────────┐
│  浏览器（生产者）     │       │  Node 主脚本（消费者） │
│  captcha-helper.html │       │  src/sniper.mjs       │
│                     │       │                      │
│  自动循环弹滑块       │──────►│  src/ticket-server.mjs│
│  你拖完 → 自动 POST  │ /push │  维护共享 ticket 池    │
│  → 自动弹下一个      │       │  轮询库存 → 有货下单   │
│                     │◄──────│                      │
│  轮询 /status        │ /status│  抢到 → setPhase(done)│
│  抢到自动停止出码    │       │                      │
└─────────────────────┘       └──────────────────────┘
```

关键点：你只需持续拖滑块，脚本自动接力消费。ticket 池空了脚本会等新 ticket 入池再继续抢，不会因为 ticket 耗尽就退出。

## 获取 Token

1. 浏览器打开 https://www.bigmodel.cn/glm-coding 并登录
2. 按 F12 → Console，运行：
   ```js
   document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]
   ```
3. 复制输出填到 `src/config.mjs`

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/sniper.ts` | **主脚本（消费者）** — 启动服务、轮询库存、并发下单 |
| `src/ticket-server.ts` | **桥接服务** — HTTP 接收 ticket、维护共享池、暴露抢购状态 |
| `src/types.ts` | 共享 TypeScript 类型定义 |
| `public/captcha-helper.html` | **验证码页面（生产者）** — 自动循环出码、拖完自动推送 |
| `scripts/setup.ts` | 首次安装引导（创建配置文件） |
| `scripts/test-connectivity.ts` | 连通性诊断（验证 token 与网络） |
| `scripts/test-rate-limit.ts` | 限流压力测试（探测 555 阈值） |
| `config.example.ts` | 配置模板（复制为 `src/config.ts`） |

## 操作步骤

1. **9:55** 启动脚本：`npm start`（自动弹出浏览器）
2. **9:56** 在浏览器里点「⚡ 自动循环出码」
3. **9:56~10:00** 持续拖滑块（每拖完一个自动入池，页面自动弹下一个）
4. **10:00** 脚本自动秒杀（9 个套餐按优先级抢，哪个有货下哪个）
5. 出支付链接后扫码付款，浏览器会自动停止出码

## 配置说明

编辑 `src/sniper.mjs` 顶部的 `CONFIG`：

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

1. **启动桥接服务** — `src/ticket-server.mjs` 监听 `http://localhost:3737`，自动打开浏览器
2. **自动出码** — 你在浏览器点「自动循环出码」，拖滑块，ticket 自动 POST 入共享池
3. **验证登录** — 调 `isLimitBuy` 接口校验 token
4. **轮询库存**（每 200ms）— 调 `batch-preview`（不消耗 ticket），一次返回全部 9 个商品状态
5. **发现可买商品** — 按 priority 排序，选第一个非售罄/非禁购的商品
6. **并发下单** — 取池子里全部 ticket 并发调 `pay/preview`（每个消耗 1 个 ticket），第一个返回 bizId 的胜出
7. **生成支付链接** — 调 `create-sign`（不消耗 ticket），输出扫码支付链接
8. **通知浏览器停止** — `setPhase('done')`，浏览器检测到状态自动停止出码

如果下单失败（555/售罄），脚本不退出，等新 ticket 入池后继续抢。

## 提示

- 每个 ticket 有效期约 3-5 分钟，建议准备 5-15 个备用
- 抢购前先用 `npm run test:ratelimit` 测当前网络的 555 限流情况
- 填好 token 后用 `npm run test:connect` 验证是否生效
