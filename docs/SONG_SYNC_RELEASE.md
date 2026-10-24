# 儿歌收藏同步与微信绑定 0.1.5

日期：2026-10-24（Asia/Shanghai）。应用「Brclio 悦创」，AppID `wx59aa532fbf6fa540`。

## 本版内容

- 登录后自动同步儿歌收藏及取消收藏，断网时先保存本机，联网后重试。旧版本机收藏迁移给首个接续访客数据的账号，各账号隔离。播放模式和最近进度仅保存在各账号的本机缓存。
- 邮箱或账号密码登录后，可点击「微信一键登录并绑定」，保留用户 ID、账号、密码、会话及收藏；下次微信登录进入同一账号。微信已被其他账号绑定时明确拒绝，不合并或替换账号。
- 新版同步请求声明 `X-Brclio-Sync-Version: 2`，包含儿歌收藏；旧端响应仅隐藏新增字段并保留真实 revision，旧版学习和挑战同步可继续使用，旧端写入保留云端儿歌收藏。
- 延续现有 Data/UserData 两个私有仓库，不创建存储资源，不新增或轮换 Secret。生产 13 项既有配置均为 Encrypted，仅核对名称和状态。

## 发布前验证

`npm run build`、`npm test`（481/481）、`npm run check:release`（101 项）和 `git diff --check` 全部通过。版本号已同步至包配置、锁文件、小程序配置与网页目录，官方微信上传说明已改为本版功能。凭据扫描无命中，`.dev.vars` 与 `artifacts/` 继续被 Git 忽略。

日志位于本地 `artifacts/account-song-sync/`。本地验证不代表微信真机或审核通过。

## 发布阶段

- GitHub：功能源码提交 [`46f20e34bab2271f4db6bb4401e88d430af72bf1`](https://github.com/Brclio/Brclio-Miniapp/commit/46f20e34bab2271f4db6bb4401e88d430af72bf1) 已推送 `main`，对应 [v0.1.5 源码发布](https://github.com/Brclio/Brclio-Miniapp/releases/tag/v0.1.5)。后续发布记录提交只更新文档。
- Pages：Production 部署 [`16323c48-f857-4985-8b1d-6e7f4c677d0a`](https://16323c48.brclio-miniapp-wechat.pages.dev)，来源为上述功能提交；生产 13 项 Encrypted 配置名称核对一致，没有修改 Secret。
- 双域公开资源：`pocket.bornforthis.cn` 与 `pocket.brclio.com` 每域 1,668 个文件的长度与 SHA256 全部一致，各含 47 张 JPEG 歌曲封面；合计 **3,336 项文件 + 12 项路由 = 3,348/3,348** 通过。每域 106,459,374 字节，完整清单摘要同为 `ea8d6eeb5c742e898825cd851f315b280949d80462e7e20d7cb43a36cd59628c`。12 个 HTML 请求返回 Pages 正常 308，已仅针对这些条目核对同域规范网址并通过字节比对；首轮响应与复核证据保留。最终报告为本地 `artifacts/account-song-sync/production-verification.json`，逐文件清单为 `public-assets-manifest.json`。
- 合成账号生产联调：25 次真实 API 请求、37 项检查通过，验证密码登录、收藏增删读回、账号隔离、409、旧端隐藏新字段与写入保留收藏、微信绑定拒绝与会话保留。两组合成账号的当前文件均已按所有权验证清理。报告为本地 `artifacts/account-song-sync/live-2026-10-24T10-21-26-808Z-418b35265d69/report.json`。
- 微信：官方 CLI `preview` 成功；**0.1.5 开发版于 18:22:00 上传成功**，CLI 返回 `✔ upload`、退出码 0。上传主包 1,413,373 字节，育儿分包 597,450 字节，总计 8,324,100 字节；主包与每个分包均小于 2 MiB。Preview 主包 1,334,927 字节、总计 8,245,654 字节，与上传口径分别记录。上传前后 450 个本地源文件的长度与 SHA256 完全一致，清单摘要 `16aa75d947bcbe6f3491a2cba5acf74973fbfb74b6621e0bfe353ca3df5d5e37`；这是源码指纹，不是上传二进制指纹。证据为本地 `artifacts/account-song-sync/native-source-manifest.json`、`wechat-upload-0.1.5.log` 和 `artifacts/wechat-upload-0.1.5.json`。

本轮微信公众平台已在现有 Chrome 页面尝试读取；Computer Use 明确返回 `Computer Use is not allowed on the current browser URL`，并说明用户自行打开也不能继续自动操作，因此停止该浏览器会话，没有换入口或接口绕过。微信后台审核提交及正式发布尚未完成，需所有者在「管理 → 版本管理」选择本次 **0.1.5 / 18:22 上传包**接续。请完成实际微信绑定、跨设备收藏和 iOS/Android 验收，再按平台要求提交审核；审核通过后正式发布并记录平台成功状态。

建议更新说明：

> 登录后自动同步儿歌收藏，支持离线重试及账号隔离；账号密码登录后可一键绑定微信，后续微信登录进入同一账号，保留原账号密码与收藏。保留 47 首儿歌及独立插画封面、摄影、双人挑战与悦学。

## 线上联调

显式运行 `node scripts/nursery-live-smoke.mjs` 会使用 `.dev.vars`，在既有两个私库创建本轮随机、隔离的合成账号，验证真实密码登录、儿歌收藏增删读回、账号隔离、revision 冲突和旧端兼容。不会发送或读取邮件，不绑定真实微信；微信接口只检查未认证与无效 code 的拒绝及原会话保留。

脚本先保存不含密码或 token 的恢复清单，再写入合成数据；结束时核对本轮身份标记、凭据和索引所有者，只删除这些测试账号的当前文件。Git 历史及限流计数保留。安全报告与清单位于被忽略的 `artifacts/account-song-sync/live-*/`。真实微信成功绑定与 iOS/Android 跨设备收藏仍需小程序验收。
