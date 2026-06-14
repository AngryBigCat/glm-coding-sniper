# GLM Coding Plan 抢购脚本

智谱 GLM Coding Plan 订阅抢购工具。

## 使用方法

1. 复制 `config.example.mjs` 为 `config.mjs`
2. 填入你的 AUTH_TOKEN（从浏览器 Cookie 获取）
3. 运行脚本

```bash
node glm-sniper-remote.mjs
```

## 获取 Token

1. 浏览器打开 https://www.bigmodel.cn/glm-coding
2. 按 F12 → Console
3. 运行：`document.cookie.split("; ").find(c => c.startsWith("bigmodel_token_production="))?.split("=")[1]`

## 文件说明

- `glm-sniper-remote.mjs` — v4 主抢单脚本
- `glm-sniper-remote-v2.mjs` — v2 版本
- `captcha-helper.html` — 验证码辅助页面（企业版 TCaptcha）
- `config.example.mjs` — 配置模板

## 抢购流程

1. 9:55 启动脚本
2. 9:58 双击 `captcha-helper.html` → 点按钮 → 滑块验证 → 复制 ticket+randstr 到终端
3. 10:00 脚本自动轮询抢购（Lite→Pro→Max 优先级）
4. 出支付链接后扫码付款
