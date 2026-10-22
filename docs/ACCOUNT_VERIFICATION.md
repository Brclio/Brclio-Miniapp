> 当前 `0.1.3` 的永久登录、自动同步、GitHub 提交、Pages 部署与微信开发版上传以 [ACCOUNT_SYNC_RELEASE.md](ACCOUNT_SYNC_RELEASE.md) 为准；下文保留此前阶段的实际记录，不作为本版发布状态。

# 2026-10-22 独立账号实现验收

本轮根据新指定的两个私有仓库实现小程序自己的账号体系，替代已撤回的跨产品共享账号代码。工作目录有本轮之前的修改；本轮保留其他内容，未提交或推送源码。独立账号 Pages 后端已部署并完成真实邮箱联调；小程序上传、真机、审核与正式发布尚未完成。下表只描述实际取得的证据。

| 阶段 | 结果 |
| --- | --- |
| 源码 | 邮箱/账号/密码/验证码注册、邮箱验证码登录、邮箱密码、账号密码、微信登录及自动注册、微信用户绑定邮箱、会话恢复与退出已实现 |
| 自动测试 | 修复 Workers 运行时兼容问题后，全量 `npm test`：319/319 通过，0 失败、0 跳过 |
| 构建 | `npm run build` 通过，包含原生账号页和 Pages 服务端产物 |
| 发布静态检查 | `npm run check:release` 84 项通过，首页按钮宽度修复后再次检查通过（`post-domain-release-check.log`）；`git diff --check` 通过；3,831 个源码与产物文件对本轮真实 Secret 值扫描，匹配数为 0 |
| 微信开发工具 | Stable `2.02.2608080`，工程 AppID `wx59aa532fbf6fa540`，`urlCheck: true`。用户截图确认 request/uploadFile/downloadFile/business 域名并核对 AppID 后，再次执行官方 CLI 网络缓存清理和完整退出重启，原生微信登录成功；首次自动注册、退出、重复登录均实测通过，私有库用户数 0→1→1，UID 与创建时间不变。系统代理已恢复；实体手机未验收 |
| 首页头部 | 修复登录/关于按钮默认宽度挤压品牌的问题，仅改 `miniprogram/pages/home/index.wxml` 与 `index.wxss`；18:31 截图确认标题与 slogan 恢复正常单行。此前后端 319 项测试已通过，该低风险样式修复未额外新增测试 |
| 私有仓库 | 两个指定仓库均为 `private:true`、默认分支 `main`；以 App 实际写入、读回与删除均通过；生产邮箱隔离测试账号与偏好当前文件均已清理，真实微信用户保留 |
| GitHub App | installation `174043179`，所有者 `BrclioData`，Contents write；实际 `repository_selection: all`。用户明确授权保持全部仓库安装范围；运行时每次仅申请固定的单个目标仓库 token |
| Gmail | 生产环境通过 Gmail TLS SMTP 发送 3 封验证码，IMAP 只读查询仅匹配专用测试 alias，确认两封注册及一封登录验证码实际收件 |
| 本地配置 | 根 `.dev.vars` 已填充、权限 0600、被 Git 忽略；不在源码、文档或静态页面公布值 |
| 生产配置 | `wrangler pages secret bulk` 成功上传 13 项；随后 Secret 名称列表确认全部为 Encrypted；只改 Pages production 配置，没有配置 preview |
| Pages 部署 | 正式部署 [da68dc74](https://da68dc74.brclio-miniapp-wechat.pages.dev)，完整 ID `da68dc74-b059-47c8-afcc-caf82c12f903`，Production/main；来源为带本轮未提交改动的工作目录。`https://pocket.bornforthis.cn` 的真实隔离账号测试 22 个请求、29 项存储与隔离检查全部通过 |
| 双域线上复核 | 两个 pocket 域名合计 14 项探测通过：health 200，未登录 session/data 401，首页与 runtime.js 均 200 且 SHA-256 匹配本地产物，`/_worker.js` 和 `/.dev.vars` 均 404 |
| 运行时修复 | Workers `fetch` 不接受 `redirect: 'error'`，已改为 `manual`，非成功与重定向响应继续拒绝；修复后重新构建、测试、部署并联调 |
| 微信发布 | 本轮未上传开发包、提交审核或正式发布 |

## 本轮生产 Secret 名称

`ACCOUNT_ENABLED`、`ACCOUNT_HMAC_SECRET`、`EMAIL_FROM`、`EMAIL_PROVIDER`、`GITHUB_APP_CLIENT_ID`、`GITHUB_APP_ID`、`GITHUB_APP_PRIVATE_KEY`、`GITHUB_DATA_BRANCH`、`GITHUB_USERDATA_BRANCH`、`SMTP_APP_PASSWORD`、`SMTP_USERNAME`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`。这里只记录名称，不记录值。

## 存储与验证范围

账号资料、凭据、验证码、身份索引、会话和限流记录仅访问 `BrclioData/Brclio-Miniapp-UserData`；业务偏好 API 仅访问 `BrclioData/Brclio-Miniapp-Data`。用户目录为 `users/v1/<ID前两位>/<用户ID>/`。账号密码按所有者明确要求，在私有用户目录的 `credentials.json` 保存明文副本，另保留 PBKDF2 校验记录；接口资料、本机缓存和前端文案不包含该副本。仓库管理员和 Git 历史仍可读取明文。

自动测试使用可控时钟、隔离内存事务、模拟 SMTP 和 GitHub API，覆盖邮件构造与协议解析、代码一次性使用及用途隔离、次数/过期/发送窗口、密码错误、并发唯一性、会话撤销、微信身份复用、绑定账号隔离、用户业务数据隔离和 revision 冲突。GitHub 测试还验证非强制 ref 更新、固定 HEAD 读取、原子多文件提交、冲突重试、令牌隔离、私有仓库检查及可见性变化后拒绝写入。

2026-10-22 16:51–16:54（Asia/Shanghai），`scripts/account-live-smoke.mjs` 从正式域名创建两个独立 QA 用户，完成邮箱验证码注册、重复邮箱拒绝、邮箱密码登录、账号密码登录、错误密码拒绝、邮箱验证码登录及重放拒绝、会话恢复、退出后 401 与另一会话继续有效、偏好写入/读回、跨用户隔离和 revision 冲突。直接读回两库文件，确认每位用户的独立目录、明文密码仅在合成凭据文件中、API 响应无密码、Data 只含业务偏好。两个测试用户的 profile、credentials、sessions、对应 identity/challenge 与 preferences 当前文件均清理成功；Git 历史和 abuse 计数按设计保留。

17:55 的微信登录尝试仍未通过开发工具本地 request 域名校验。只读核对 UserData 当前状态及 17:54 前快照均为 0 个 profile，HEAD 时间仍为 16:54:15；没有据此声称微信登录或自动注册已成功。用户已确认后台添加域名，工具显示未同步只是已观察到的现象，不能据此认定缓存是根因。

用户单独批准临时直连测试后，截图确认代理页已选中直连；直连下重启/重开工程并刷新详情域名仍显示旧列表。现已恢复系统代理，截图确认已选中。18:32:43（Asia/Shanghai）再次微信登录仍被 DevTools 本地 request 校验拦截，不能认定登录成功或代理是根因；安全汇总见被忽略的 `artifacts/account-verification/wechat-domain-sync.json`。

上述拦截为历史排查结果。用户随后提供后台截图，确认 `https://pocket.bornforthis.cn` 已在 request、uploadFile、downloadFile 与业务域名中，并确认 AppID 与工程及后端一致。官方 CLI `cache --clean network --project ...` 成功后，完整退出并重启工具，19:21 原生微信登录成功，页面显示「已登录」「微信登录成功，欢迎来到悦创」。服务端真实交换微信 code 并创建首个用户；只读库快照记录首次提交于 19:21:38，用户数由 0 增至 1，目录为 `users/v1/f6/f620b1a9d06e56fa865765bc1451080f/`。退出显示「已退出登录」，随后再次一键登录成功；19:22:53 的仓库提交后，用户数仍为 1，UID 集合与创建时间均不变。对照报告 `wechat-real-login-comparison.json` 的 `passed` 为 `true`。全程保持域名校验开启；真实微信用户未删除，未替其设置邮箱、账号或密码。邮箱绑定表单原生渲染已核对并返回，实际绑定仅有自动测试覆盖。本次成功发生在后台配置确认后的清理与重启之后，不能据此把此前问题唯一归因于缓存。

安全证据位于 `artifacts/account-verification/`：`github-installation.json`、`github-live-storage.json`、`runtime-fix-full-tests.log`、`runtime-fix-full-build.log`、`runtime-fix-release-check.log`、`pages-runtime-fix-deploy.log`、`live-api-smoke.json`、`production-domains.json`、`final-secret-scan.json`。这些文件被 Git 忽略；报告不含邮箱、验证码、密码、原始会话 token、私钥或提供方诊断。部署 Worker 为 63,838 字节，SHA-256 `c806bfad40c6190c5a80a897dc963f849a64bcd4572ff65ca788fb0ecefcf5ec`；构建来源快照为 `deploy-source-manifest.json`。未将工作目录部署记为源码提交或推送。

## 下一步

1. 在用户自行选择邮箱、账号和密码后，验证真实微信用户的邮箱绑定及后续登录；当前绑定逻辑已通过自动测试，尚未向真实微信用户提交绑定。
2. 核对微信隐私保护指引，再分别完成并记录本轮小程序上传、iOS/Android 实体真机、审核和正式发布。开发工具的真实身份交换验收不等同于这些发布阶段。

配置指引见 [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md)，存储设计与 API 见 [ACCOUNT_PLAN.md](ACCOUNT_PLAN.md)。
