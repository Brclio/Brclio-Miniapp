# 共享账号与手动同步

2026-10-21：原生小程序已完成源码接入和 mock 验证；独立 Pages 账号代理的生产部署与真实隔离测试账号联调已另有记录，见 [VERIFICATION.md](VERIFICATION.md)。新的微信账号页尚无上传或正式发布证明，微信真机、审核和正式发布分别验收。

## 统一账户与仓库

统一账户由 `https://tools.brclio.com/api/account/*` 服务负责，指定私有数据仓库为 `BrclioData/BrclioUserData`。小程序不创建第二套账号索引、不自行调用 GitHub，也不持有 GitHub token、微信 AppSecret 或 session_key。账户和用户 ID 完全来自中央服务验证的会话。

小程序原生请求固定进入 `https://pocket.bornforthis.cn/api/account/*`，携带 `X-Brclio-Client: native`，登录成功后将用户自己的 bearer 会话保存到微信本机缓存。未调用 `wx.login`，不读取微信头像或微信身份。账号支持邮箱验证码注册、账号或邮箱加密码登录、资料更新、密码设置和退出。既有 Google 用户可在 Brclio 账号网站设置密码后登录小程序。

账户资料和应用数据为明文 JSON，包含用户设置的明文密码；仓库授权管理者可读取。前端明确说明此存储方式并提醒勿复用密码。中央账户服务使用 GitHub App 的 `GITHUB_APP_ID`、`GITHUB_APP_INSTALLATION_ID` 和服务端 Secret `GITHUB_APP_PRIVATE_KEY` 获取仓库范围的短期 installation token，不使用个人 PAT；App 私钥与 installation token 不进入小程序、Pages 代理、产物或日志。

## 应用数据契约

小程序仅读写 `users/<中央用户ID>/apps/miniapp/data.json` 对应的 API，不接受客户端自选仓库、用户路径或 URL。

```text
GET /api/account/apps/miniapp/data
  -> { userId, appId: "miniapp", version: 1, revision, data, updatedAt }
PUT /api/account/apps/miniapp/data
  <- { revision: 刚读取的版本, data: { duel: { preferences, matches } } }
```

`preferences` 为 `{targetScore:1|3|5,haptics:boolean,names:[玩家名,玩家名]}`。`matches` 最多 20 个 `{id,at,names,winner,scores,bestMs}`，其中 `at` 为毫秒时间戳，`winner` 为 0 或 1，`scores` 为两名玩家的最终分数，`bestMs` 为反应成绩或 `null`。`data` 最多 12000 UTF-8 字节。仅传白名单挑战字段，不上传浏览记录、用户选择的照片或其他应用数据。

每次备份或恢复都先读取当前账号云端数据，显示目标账号、本机/云端记录数和覆盖方向，再由用户确认。登录、打开页面、游玩、退出均不自动上传或恢复。`409` 不自动重试写入，保留本机并要求重新读取和预览。

备份时保留服务端已有未知对象字段，仅替换本应用已知的挑战偏好与对局数组。恢复时重新检查云端 revision 与本机快照，先将恢复前完整本机数据保存到 `brclio.duel.before-restore.v1`，再替换已知挑战字段，保留未知本机字段；副本写入失败则不恢复。若需要人工回滚，该缓存值的 `data` 为恢复前原样数据。退出登录不删除本机挑战记录或副本。共享设备的本机记录不自动归属某个账户，备份预览明确提示目标账号。

## 固定代理与部署

`web/account-proxy.mjs` 只允许 `session/code/register/login/logout/profile/password/apps/miniapp/data` 的精确方法组合。拒绝查询参数、未知路径、跨站 Origin、非 native 请求、跳转、非 JSON 和过大请求/响应。只转发当前用户 bearer，不转 Cookie、GitHub 凭据或任意请求头；上游错误不记录密码或 token。

项目实际构建为 Pages advanced `_worker.js`，因此 `web/pages-worker.mjs` 直接挂载该模块。`functions/api/account/[[path]].js` 同样调用该模块，供后续使用 Functions 模式时复用；只有添加 Functions 文件不能改变现有 advanced 构建的路由。旧匿名 `/api/v1/*` 保持 503，不自动迁移匿名设备备份，不将旧设备 token 当成共享账号。

部署前需确认中央应用接口可用，再构建并发布 Pages 代理；在微信后台核对 `https://pocket.bornforthis.cn` 的 request 合法域名、小程序备案与隐私声明。本次源码修改不表示这些配置已经完成。独立 H5 门户仍为访客浏览，本轮没有开放 H5 账号或 Cookie 跨域登录。

## 验证

`tests/account.test.js` 覆盖共享会话、离线退出、跨账号隔离、revision 冲突、本机变化、无损恢复、恢复副本写入失败与畸形数据保留。`tests/account-proxy.test.js` 覆盖精确转发、来源/路径/方法限制、跳转、Cookie 剥离和响应边界。中央 API 隔离联调的证据见最新验收记录；真实邮件注册、微信域名配置和真机交互仍需分别验证。
