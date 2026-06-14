# GLM Coding Plan 抢购脚本

智谱 GLM Coding Plan 订阅抢购工具。TypeScript + 分层架构，浏览器拖滑块自动出码，脚本自动轮询库存并发下单。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 创建配置文件（从模板复制）
npm run setup

# 3. 编辑 config.ts，填入 AUTH_TOKEN（customerId 会自动从 token 解码）

# 4. 验证连通性（可选）
npm run test:connect

# 5. 启动抢购（自动弹出浏览器）
npm start
```

## 命令说明

| 命令 | 说明 |
|------|------|
| `npm start` | 启动抢购（起 HTTP 服务 + 开浏览器 + 轮询下单） |
| `npm run setup` | 首次安装引导，创建 `config.ts` 配置文件 |
| `npm run test:connect` | 连通性诊断（验证 token 与网络，不消耗 ticket） |
| `npm run test:ratelimit` | 限流压力测试（探测 555 阈值，不消耗 ticket） |
| `npm run typecheck` | TypeScript 类型检查 |

项目使用 TypeScript，通过 `tsx` 直接运行（无需编译）。

## 操作步骤

1. **9:55** 运行 `npm start`，自动弹出浏览器（`http://localhost:3737`）
2. **9:56** 在页面右侧点「⚡ 自动循环出码」，拖滑块
3. **9:56~10:00** 持续拖滑块（每拖完一个自动入池，页面自动弹下一个），左侧监控面板实时显示库存和抢购状态
4. **10:00** 脚本自动秒杀（9 个套餐按优先级抢，哪个有货下哪个）
5. 出支付链接后扫码付款，浏览器自动停止出码

## 页面布局

浏览器打开后显示左右分栏界面：

```
┌──────────────────────────┬──────────────────────┐
│  左栏：抢购监控           │  右栏：验证码生成器   │
│                          │                      │
│  [⏸ 暂停抢购] 按钮       │  [⚡ 自动循环出码]    │
│  📦 库存监控（9 个灯）    │  抢购阶段 / 池状态    │
│  🎯 最近下单结果          │  最近 5 个 ticket     │
│  📈 查询次数 / 运行时长   │                      │
│  📜 抢购日志（30 条滚动） │                      │
└──────────────────────────┴──────────────────────┘
```

- **库存监控灯**：🟢 有货 / 🟡 售罄 / 🔴 禁购，实时反映 9 个套餐状态
- **下单结果**：成功显示套餐+金额+支付链接，失败显示错误原因
- **抢购日志**：暗色终端风格，最近 30 条操作记录自动滚动
- **暂停/继续**：点击按钮可随时暂停或继续抢购循环

## 工作原理

采用**生产者-消费者**架构，生成 ticket 和消费 ticket 解耦：

```
┌─────────────────────┐       ┌──────────────────────┐
│  浏览器（生产者）     │       │  Node 主脚本（消费者） │
│  captcha.html        │       │  src/main.ts          │
│                     │       │                      │
│  自动循环弹滑块       │──────►│  src/server/          │
│  你拖完 → 自动 POST  │ /push │  ticket-server.ts     │
│  → 自动弹下一个      │       │  维护共享 ticket 池    │
│                     │◄──────│                      │
│  轮询 /status        │/status │  轮询库存 → 有货下单   │
│  渲染监控面板        │       │  抢到 → setPhase(done)│
│  暂停/继续控制       │/pause  │                      │
└─────────────────────┘       └──────────────────────┘
```

你只需持续拖滑块，脚本自动接力消费。ticket 池空了脚本会等新 ticket 入池再继续抢，不会因为 ticket 耗尽就退出。

## 获取 Token

1. 浏览器打开 https://www.bigmodel.cn/glm-coding 并登录
2. 按 F12 → Console，运行：
   ```js
   document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]
   ```
3. 复制输出填到 `config.ts`

> 只需配置 `AUTH_TOKEN` 一个值。`customerId` 会自动从 token 的 JWT 解码（见 `src/core/auth.ts`），无需手动获取。

## 项目结构

```
├── config.ts               真实配置（gitignore，含 token）
├── config.example.ts       配置模板
├── package.json            npm 入口 + scripts
├── tsconfig.json           TypeScript 配置
├── src/
│   ├── main.ts             主流程编排（入口）
│   ├── core/               核心业务层
│   │   ├── types.ts           共享类型定义
│   │   ├── constants.ts       常量配置 + 横幅（不含 token，纯静态）
│   │   ├── http-client.ts     HTTP 客户端工厂 + 日志（log 自动转发到浏览器）
│   │   ├── auth.ts            JWT 解码（customerId 从 token 提取）
│   │   └── api.ts             业务逻辑工厂（查库存 / 下单 / 等待 ticket）
│   ├── server/            HTTP 服务层
│   │   └── ticket-server.ts   ticket 池服务 + 页面路由 + 暂停控制
│   └── pages/             页面渲染
│       └── captcha.ts         读 captcha.html 返回给浏览器
├── public/
│   └── captcha.html       验证码页面（左右分栏 + 监控面板）
└── scripts/
    ├── setup.ts           首次安装引导
    ├── test-connectivity.ts  连通性诊断
    └── test-rate-limit.ts    限流压力测试
```

依赖方向严格单向，无循环。config 只在 `main.ts` 加载，通过工厂函数注入底层：
```
main.ts（唯一 import config）
  ├─ createApiClient(AUTH_TOKEN) → client     注入给 createApi
  ├─ getCustomerId(AUTH_TOKEN)   → customerId  注入给 createApi
  └─ createApi(client, customerId) → { verifyAuth, checkAllStock, placeOrder }
```
core/server 层不 import config，全部通过参数接收依赖。

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

优先级：Lite月 > Lite季 > Pro月 > Pro季 > Max月 > Max季 > Lite年 > Pro年 > Max年

## 配置说明

编辑 `src/core/constants.ts` 的 `CONFIG`：

```ts
export const CONFIG: AppConfig = {
  billingCycle: 'month',  // batch-preview 查询用
  autoRenew: true,
  checkInterval: 0.2,     // 轮询间隔(秒)
  payType: 'WE_CHAT',     // WE_CHAT | ALI
};
```

监控商品在同文件的 `PRODUCTS` 数组中定义，按 `priority` 字段决定抢购优先级。

## 抢购流程

1. **启动服务** — `ticket-server.ts` 监听 `http://localhost:3737`，自动打开浏览器
2. **自动出码** — 点「自动循环出码」，拖滑块，ticket 自动 POST 入共享池
3. **验证登录** — 调 `isLimitBuy` 接口校验 token
4. **轮询库存**（每 200ms）— 调 `batch-preview`（不消耗 ticket），一次返回全部 9 个商品状态
5. **发现可买商品** — 按 priority 排序，选第一个非售罄/非禁购的商品
6. **并发下单** — 取池子里全部 ticket 并发调 `pay/preview`（每个消耗 1 个 ticket），第一个返回 bizId 的胜出
7. **生成支付链接** — 调 `create-sign`（不消耗 ticket），输出扫码支付链接
8. **通知浏览器停止** — `setPhase('done')`，浏览器检测到状态自动停止出码

下单失败（555/售罄）时脚本不退出，等新 ticket 入池后继续抢。可随时点「暂停」按钮暂停抢购循环。

## 提示

- 每个 ticket 有效期约 3-5 分钟，建议准备 5-15 个备用
- 抢购前先用 `npm run test:ratelimit` 测当前网络的 555 限流情况
- 填好 token 后用 `npm run test:connect` 验证是否生效
- 浏览器页面实时显示库存监控和日志，无需看终端
