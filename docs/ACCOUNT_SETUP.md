> `0.1.3` 新增永久会话与 `/sync` 白名单自动同步；最新验收、发布和上传结果见 [ACCOUNT_SYNC_RELEASE.md](ACCOUNT_SYNC_RELEASE.md)。下文配置不变，旧部署 ID 与时间只对应初次账号联调。

# 独立账号服务配置与验收

本文件对应 [ACCOUNT_PLAN.md](ACCOUNT_PLAN.md)、`web/account-api.mjs`、`web/account-store.mjs` 与 `web/account-mail.mjs`。以下为配置指引，实际执行结果见 [ACCOUNT_VERIFICATION.md](ACCOUNT_VERIFICATION.md)。本轮已向 Pages production 加密上传并核对 13 项配置，部署 [da68dc74](https://da68dc74.brclio-miniapp-wechat.pages.dev)，正式域名真实邮箱联调通过；用户后台截图已核对服务器域名与 AppID，19:21 原生微信一键登录已成功，退出后再次微信登录已实测复用同一用户，微信账号邮箱绑定仍待实际提交验收。

## 2026-10-22 初始只读核对

- 发布命令 `npm run deploy` 指向 Cloudflare **Pages** 项目 `brclio-miniapp-wechat`，生产分支 `main`。只读项目列表确认域名为 `brclio-miniapp-wechat.pages.dev`、`pocket.bornforthis.cn`、`pocket.brclio.com`。
- 本轮开始时，`wrangler pages secret list --project-name brclio-miniapp-wechat` 的 production Secret 列表为空。该结论描述初始核对时点；后续新增配置须另记。
- 初始本地未发现已填充的 `.dev.vars` 或 `.env`；旧 `.dev.vars.example` 不能证明新账号已配置。本轮用户之后提供了邮件和微信凭据，其值不得写入本文件或日志。
- `cloudflare/legacy-worker/wrangler.jsonc` 的旧 Worker `brclio-miniapp-web` 仅列出 `DATA_HMAC_KEY`、`GITHUB_TOKEN` 旧 Secret 名称。它们不会自动传入 Pages，新账号不借用旧 Worker 或其他产品的凭据。

本轮后续核验确认两个目标仓库均为私有、默认分支 `main`；App ID `5422366`、所有者 `BrclioData`，Client ID 为 `Iv23liYOn19I2ZrQXQSq`。用户安装后，实际 installation 为 `174043179`、Contents write，两个仓库的 App 读写、读回和删除均已通过。此前安装列表为空的核对结果已被本次安装与实际操作证据更新。

App 实际安装范围为 `repository_selection: all`，用户明确授权保留全部仓库范围。后端仓库名仍固定为这两个目标，每次 installation token 只申请当前单个仓库及 Contents write，不因安装范围扩大而接收客户端仓库参数。

本地 `.dev.vars` 已配置、被 Git 忽略且文件权限为 `0600`，只记录就绪状态，不记录任何凭据值。Pages production 的 13 项配置均为 Encrypted，并已随上述正式部署生效。初始 Secret 列表为空仅描述本轮开始时点。

## 后端变量

| 名称 | 类型与用途 |
| --- | --- |
| `ACCOUNT_ENABLED` | 普通变量；仅字符串 `true` 开放账号 API |
| `ACCOUNT_HMAC_SECRET` | Secret；至少 32 个随机字符；稳定保管，用于身份索引、验证码、限流路径与密码 pepper |
| `GITHUB_APP_CLIENT_ID` | 普通变量；`Iv23liYOn19I2ZrQXQSq`，优先用于 JWT issuer |
| `GITHUB_APP_ID` | 普通变量；`5422366`，未设 Client ID 时的后备 issuer |
| `GITHUB_APP_PRIVATE_KEY` | Secret；App 完整 PEM 私钥，支持 PKCS#1 和 PKCS#8 |
| `GITHUB_APP_INSTALLATION_ID` | 可选普通变量；未配置时按固定仓库查询该 App 安装 |
| `GITHUB_USERDATA_BRANCH` | 可选普通变量；默认 `main` |
| `GITHUB_DATA_BRANCH` | 可选普通变量；学习、挑战和儿歌业务库分支，默认 `main` |
| `GITHUB_BLOG_BRANCH` | 可选普通变量；独立博客库分支，默认 `main` |
| `BLOG_ADMIN_EMAILS` / `BLOG_ADMIN_USER_IDS` | 非密钥管理员白名单；博客写作管理权限 |
| `EMAIL_PROVIDER` | 普通变量；本轮使用 `gmail`；也保留 Resend 路径 |
| `SMTP_USERNAME` | 邮件发件 Gmail 完整地址；后端配置 |
| `SMTP_APP_PASSWORD` | Secret；上述 Gmail 的应用专用密码，不是普通账号密码 |
| `EMAIL_FROM` | 发件邮箱或 `显示名 <邮箱>`；Gmail 路径须与 SMTP_USERNAME 相同 |
| `RESEND_API_KEY` | 可选 Secret；只在未选择 Gmail/未配置 SMTP_USERNAME 的 Resend 路径使用 |
| `WECHAT_APP_ID` | 普通变量；当前工程 `wx59aa532fbf6fa540` |
| `WECHAT_APP_SECRET` | Secret；当前微信小程序的 AppSecret，与 GitHub App 私钥不同 |

非敏感变量可放在实际部署的根 `wrangler.jsonc` 的 `vars`；本地 Secret 放进根目录被 Git 忽略的 `.dev.vars`。不要将 Secret 填入 `vars`、小程序配置、前端源码、测试快照或静态构建产物。production 与 preview 分别核对；预览环境不可无意连接正式用户数据。

生产 Secret 在 Pages 项目的 **Settings → Variables and Secrets** 中设置并加密，也可运行 `npx wrangler pages secret put 名称 --project-name brclio-miniapp-wechat`，按提示输入。导入 PEM 可从私钥文件重定向标准输入，避免复制到源码或日志。Secret 应先于使用它的部署配置；新增后重新部署。[Cloudflare Secret 指引](https://developers.cloudflare.com/pages/functions/bindings/#secrets)

## GitHub App 与仓库

0.1.9 起，App 安装须同时包含以下三个私有仓库，授予 Repository Contents 读写：

- `BrclioData/Brclio-Miniapp-UserData`
- `BrclioData/Brclio-Miniapp-Data`（学习、挑战、儿歌偏好）
- `BrclioData/Brclio-Miniapp-Blog-Data`（文章与互动，结构化 JSON）

后端分别申请仅包含当前仓库的 installation token，按返回到期时间刷新，不依赖固定 token 长度或个人 PAT。Client ID 可作为 JWT `iss`，GitHub 官方推荐该方式；App ID 和 Installation ID 是不同标识。[GitHub JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)、[Installation token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)

默认使用现有 `main`。完全空的仓库可在首次写事务中创建 `.brclio-store.json` 初始化；已有其他分支而指定分支缺失时拒绝，不猜分支。分支规则须允许该 App 提交。验收需核对实际 Git 提交及路径，配置检查不能代替写入证明。

## Gmail 与可选 Resend

Gmail 路径使用 Cloudflare `cloudflare:sockets` 固定连接 `smtp.gmail.com:465`，从连接开始启用 TLS，再进行 SMTP AUTH PLAIN。发件人固定为认证邮箱，不接收客户端指定主机或发件人。总超时 20 秒，出错关闭 socket；SMTP 错误只返回通用失败，不泄露凭据与服务器诊断。MIME 使用 UTF-8/base64，验证码邮件的用途、主题和正文由后端生成。[Google SMTP 文档](https://developers.google.com/workspace/gmail/imap/imap-smtp)、[Cloudflare TCP sockets](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)

Gmail 应用专用密码由账号管理员提供并仅存 Secret。Gmail 接受 SMTP 请求后仍可能受发件配额、过滤和投递状态影响；真实送达须确认收件箱。Cloudflare 禁止出站 TCP 25，当前实现使用 465。本轮生产已发送并通过只读 IMAP、限定收件 alias 和用途确认 3 封验证码实际送达，不将其解释为容量验收。

没有选择 Gmail、没有配置 SMTP_USERNAME 时才使用 Resend，需 `RESEND_API_KEY` 与其已验证域名下的 `EMAIL_FROM`。Resend 并非本轮 Gmail 方案的前置要求。[Resend API](https://resend.com/docs/api-reference/emails/send-email)、[域名验证](https://resend.com/docs/dashboard/domains/introduction)

## 微信登录

原生 `wx.login` 的 code 有效期五分钟。后端请求 `https://api.weixin.qq.com/sns/jscode2session`，携带本工程 `appid`、`secret`、`js_code` 及固定 `grant_type=authorization_code`，取得当前小程序范围内的 openid。AppSecret、session_key 不返回客户端；unionid 不是注册前提。[微信 wx.login](https://developers.weixin.qq.com/miniprogram/dev/api/open-api/login/wx.login.html)、[登录凭证校验](https://developers.weixin.qq.com/miniprogram/dev/server/API/user-login/api_code2session.html)

微信账号与资源请求使用 `https://pocket.bornforthis.cn` 的 request 与 downloadFile 合法域名。用户后台截图已确认 request、uploadFile、downloadFile 与业务域名均为该域名，后台 AppID 与工程 `wx59aa532fbf6fa540` 一致。开发工具 Stable `2.02.2608080` 中，19:20 官方 CLI `cache --clean network` 成功后执行完整 `quit` 并重启，19:21 原生微信一键登录成功，账号页显示「已登录」「微信登录成功，欢迎来到悦创」；`urlCheck: true` 和系统代理保持启用。退出后再次微信登录已实测复用同一用户，微信账号邮箱绑定仍待实际提交验收，iOS/Android 真机及本轮小程序上传、审核、发布也未完成。按真实邮箱、账号、微信登录标识与主动偏好存储更新微信隐私保护指引。

首次登录与退出再登的 UserData 只读对比已通过：首次提交时间 19:21:38、复登提交时间 19:22:53（Asia/Shanghai），两次 profile 数均为 1，用户 ID 集合与 createdAt 一致，没有第二份 profile。安全证据为被 Git 忽略的 `artifacts/account-verification/wechat-real-login-comparison.json`。邮箱绑定原生表单已渲染后取消，未实际提交；真实微信账号的邮箱绑定仍仅有源码和自动测试覆盖。

历史排查：此前详情刷新、重开项目、工具重启及图形界面清除网络缓存后仍显示旧 picbling 列表。用户另行批准的临时直连测试经截图确认选中，直连重启/重开和刷新仍未同步；随后系统代理已恢复并截图确认。18:32:43 的登录仍被本地 request 校验拦截，该失败已由 19:21 的成功登录更新；这些现象不能单独证明代理或缓存为根因。

## Pages 构建与路由

`npm run build` 将 `web/pages-worker.mjs` 打包为 `dist/web/_worker.js`，账号路由须接收实际 `env`，同时保留 ASSETS、项目路径限制和发音路由。`dist/web/_routes.json` 包含 `/api/*`。构建器将 `cloudflare:sockets` 保留为 Workers 运行时导入，不打入浏览器脚本。

Workers 的 `fetch` 不接受 `redirect: 'error'`；本轮生产联调后已统一改为 `manual`，重定向及其他非成功响应继续拒绝，避免自动向重定向目标发送后端凭据。修复后的全量测试 319/319、构建和 84 项发布检查通过，并重新部署后完成真实账号联调。

Pages advanced mode 使用 `_worker.js` 时忽略整个 `functions/`。仅更新 `functions/api/account/[[path]].js` 不会改变当前生产路由。Pages 的 `pages_build_output_dir` 不可混用旧 Worker 的 `main/assets` 配置。[Advanced mode](https://developers.cloudflare.com/pages/functions/advanced-mode/)、[Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)

## 验收顺序

1. 运行账号/API/存储/邮件测试、完整 `npm test`、`npm run build`、`npm run check:release` 和 `git diff --check`；检查产物没有 PEM、Secret 值或旧跨产品账号地址。
2. 核对两个仓库的 App 安装、分支和权限，只记录 Secret 名称与就绪状态。
3. 以隔离测试账号验证真实邮箱注册、邮箱密码、账号密码、邮箱验证码登录及邮箱实际送达；从真实微信客户端验证首次注册和重复登录同一用户。
4. 验证验证码过期、次数限制、用途隔离、重复发送、并发注册、并发消费、退出、过期会话、跨用户读取和数据 revision 冲突。
5. 检查实际路径：每位用户独立目录，账号凭据及所有者要求的密码明文副本仅入 UserData 的 credentials.json、偏好仅入 Data；公开资料、API 响应和客户端不含密码；仓库不保存验证码明文、原始 token 或微信 session_key。
6. 记录 Pages 部署 ID、线上代码与结果。小程序上传、实体手机体验、审核及正式发布另记，不能由 Pages 部署推断。

可重复的真实邮箱验收命令为 `node scripts/account-live-smoke.mjs`，默认仅访问正式 `https://pocket.bornforthis.cn`；可选参数仅接受另一个既定 pocket 域名。它读取被忽略的 `.dev.vars`，创建两个专用 alias 与合成密码，验证码只读查询精确收件 alias，结束时仅清理本次用户、身份、挑战、偏好及同步当前文件。安全报告写入被忽略的 `artifacts/account-verification/live-api-smoke.json`；运行会真实发送邮件和写入测试记录，不应作为普通离线构建步骤。

本轮该脚本的 22 个请求和 29 项检查通过，两个用户当前文件清理成功。清理不会清除 Git 历史，abuse 计数也保留。密码 KDF、多次 GitHub 请求和 Gmail socket 已在实际 Pages 环境完成此次功能及网络联调；配额和生产容量仍需按实际流量持续评估。原生微信一键登录的最新成功记录见上文；退出再登的用户 ID 复用已实测通过；微信账号邮箱绑定及小程序发布另行验收。
