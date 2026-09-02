# 浏览器 E2E

测试使用锁定在开发依赖中的 Playwright Test 1.55.0。默认使用本机 Chrome；CI 如使用 Playwright 托管的 Chromium，先安装并传入 `E2E_BROWSER_CHANNEL=bundled`。

## 本地

```bash
cd demo
npm run e2e:install
E2E_BROWSER_CHANNEL=bundled npm run e2e
```

本机已有 Chrome 时可直接执行 `npm run e2e`。

`npm run e2e` 会先构建生产静态文件，再启动三个隔离进程：本地索引应用、内存 Supabase mock、确定性 LLM mock。默认端口分别为 `18790`、`15431`、`15432`，可用 `E2E_PORT`、`E2E_DATA_PORT`、`E2E_LLM_PORT` 覆盖。Playwright 退出后会终止这三个子进程；不会连接或清理真实数据。

常用命令：

```bash
npm run e2e:headed          # 桌面 Chromium 可视运行
npm run verify:browser      # 桌面 + Pixel 7 浏览器验证
```

本地账号默认在运行时随机生成，只存在于内存 mock。若要指定账号，临时注入：

```bash
E2E_EMAIL='...' E2E_PASSWORD='...' npm run e2e
```

不要把邮箱、密码、token 或 `.env` 提交到仓库。

## 生产 smoke

生产 smoke 只读取公共页面，不登录、不写数据：

```bash
SITE_URL=https://app.huojiaocan.workers.dev npm run verify:production:browser
```

若未来需要对非本地环境执行写入链路，必须显式增加独立的 opt-in 测试、唯一运行标识和对应删除 API；当前套件不会对真实服务创建账号、草稿、卡片或课堂记录。

## 覆盖与产物

- 匿名教材浏览、教材页码和 PDF 阅读器返回路径
- 精确搜索及学生教材/教师用书跨文档定位
- 登录前问题恢复、刷新恢复、连续问答
- 教师确认、三卡生成、逐卡锁定和课堂入口
- 桌面与移动 Chromium
- 每个测试自动拦截 `console.error` 和未捕获页面异常

失败时保留 trace 和截图，位于 `demo/node_modules/.cache/playwright-results`；HTML 报告位于 `demo/node_modules/.cache/playwright-report`。
