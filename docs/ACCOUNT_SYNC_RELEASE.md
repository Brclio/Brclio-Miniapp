# 0.1.3：持续登录与操作同步

2026-10-22。此文记录新版本；先前独立账号联调见 [ACCOUNT_VERIFICATION.md](ACCOUNT_VERIFICATION.md)。本轮已获授权提交 GitHub、部署 Pages、上传微信开发版；审核由所有者自行提交。

## 行为

- 登录无固定到期时间，返回 `expiresAt: null`；既存会话兼容迁移，不因 30 天或其他设备登录被踢出。主动退出立即结束当前设备登录，联网撤销对应服务端会话；断网撤销排队重试。
- 用户操作先写本机，再节流上传；离线保留待同步队列，回到前台、页面切换、网络恢复时重试。首页和账号页安全拉取并合并云端，进行中的游戏不会因后台响应被覆盖。
- 本机、同步元数据、未上传变更和通关文件均按账号隔离。既有访客数据仅由第一个登录账号领取一次，后续账号不重复领取，迟到响应无法写进新账号。
- 声音、振动、计分规则、玩家名、最近 20 场计分战绩、ReadyGo 标题/等待时间、学习进度、收藏、学习偏好和最近 200 条通关足迹同步。完整本机通关历史继续保留并可导出；彩头、彩头查看密码、聊天 TXT、照片和资源缓存不上传。
- 学习已见词和最佳成绩合并保留，收藏与设置采用较新的修改；通关与对局按 ID 去重。删除设置使用带时间戳的空值，清空战绩不会被旧云端记录重新填回。超出同步大小限制时保留本机并显示状态，避免截断原始进度。

## 存储与接口

账号数据仍只进入 `BrclioData/Brclio-Miniapp-UserData`，同步数据只进入 `BrclioData/Brclio-Miniapp-Data`。用户目录结构为 `users/v1/<UID前两位>/<UID>/`；新增业务文档 `sync.json`，原 `preferences.json` 接口兼容保留。

`GET /api/account/sync` 返回 `{revision, entries}`；`PUT` 接受 `{revision, entries: {固定键: {value, updatedAt}}}`。服务端校验白名单、业务类型和大小，账号由 bearer 会话确定；冲突返回 409，客户端重读后合并重试。单请求 256 KiB、单条目 200 KiB、单用户文档 768 KiB；超限不破坏本机数据。

## 发布证据

| 阶段 | 本次取得的证据 |
| --- | --- |
| 源码 | GitHub `main` 已推送代码提交 [`1868c9d1ad5d69155a560fc58cd0f13001178021`](https://github.com/Brclio/Brclio-Miniapp/commit/1868c9d1ad5d69155a560fc58cd0f13001178021)；发布和上传均使用此提交的运行代码，后续仅补充文档 |
| 构建和回归 | `npm run build` 成功；全量 `npm test` 366/366，0 失败、0 跳过；`npm run check:release` 87 项通过；`git diff --check` 通过 |
| 凭据检查 | 3,836 个非忽略源码与产物文件扫描真实凭据值，匹配 0；`.dev.vars`、私钥和本地验收文件未提交，不在小程序包根 |
| Pages | Production/main 部署 [`3f800733`](https://3f800733.brclio-miniapp-wechat.pages.dev)，完整 ID `3f800733-0974-447b-a9ba-d2cb14344190`，来源 `1868c9d`，无未提交代码；Worker 74,570 B，SHA-256 `19cf812e07091adafa048ab3af9199cdac4dca1b16b1bb3ef2530a293b450179` |
| 正式域名 | 两个 pocket 域名合计 14 项探测通过：health 返回 0.1.3，未登录 session/sync 返回 401，首页和 runtime.js 与构建哈希一致，Worker 与环境文件不可下载 |
| 生产账号/同步 | 真实 Gmail 收件、两独立 QA 用户及全部登录方式、永久 session、撤销、同步 CAS、白名单、分库和跨用户隔离共 31 个请求、45 项检查通过；两个 QA 用户的账号、偏好及同步当前文件均已清理，真实微信用户保留，Git 历史与限流计数保留 |
| 原生实际操作 | 开发工具编译后缓存会话仍登录，账号页显示持续登录与「已同步」；只读库验证同一微信用户的全部现存会话均 `expiresAt:null`。声音开关 true→false→true 对应 Data 文档 revision 1→2→3，已恢复原设置；只读快照无凭据、邮箱、原始微信标识或玩家名 |
| 微信上传 | 官方 `npm run wechat:upload` 退出 0 并返回 `✔ upload`；上传参数为 AppID `wx59aa532fbf6fa540`、版本 `0.1.3`。回执主包 1,372,820 B，四分包 1,666,814 / 1,239,344 / 1,619,348 / 1,787,771 B，总计 7,686,097 B；每包低于 2 MiB |
| 审核和真机 | 已上传开发版，尚未提交审核或正式发布。实体 iOS/Android 验收未在本轮完成；审核由所有者提交 |

本机被忽略的证据目录为 `artifacts/account-verification/`，包含 `0.1.3-full-tests.log`、`0.1.3-release-check.log`、`0.1.3-preflight.json`、`0.1.3-source-manifest.json`、`0.1.3-pages-deploy.log`、`0.1.3-production-domains.json`、`0.1.3-live-api-smoke.json` 和 `0.1.3-native-sync-*.json`。微信大小回执为 `artifacts/wechat-upload-0.1.3.json`。不将开发工具身份交换等同于实体真机验收，也不将开发版上传等同于审核或正式发布。

依赖检查：生产依赖审计为 0；开发构建链报告 7 项告警，其中 selector-parser 6.1.5 已有上游安全回移，braces 3.0.3 尚无已发布补丁。构建只读取本仓库可信源，相关包不进入 Pages 或原生运行依赖；未以强制大版本升级替代兼容性检查。

## 审核交接

上传开发版不等同于正式发布。选择 `0.1.3` 开发版本，按 [微信隐私填报说明](WECHAT_PRIVACY_FILLING.md) 和 [补充文档](WECHAT_PRIVACY_SUPPLEMENT.txt) 核对本版的邮箱、微信登录与业务同步范围后，由所有者提交审核。实体 iOS/Android 体验与审核结论分别记录，不由开发工具测试代替。
