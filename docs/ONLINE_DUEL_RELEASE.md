# 在线 PK、分享邀请与好友 · 0.1.11

日期：2026-10-28（Asia/Shanghai）。用户授权完成分享邀请、邀请码、好友后全面核查并上线，指定实时域名 `pk.brclio-miniapp.bornforthis.cn`，微信服务器域名由用户填写。

## 功能与存储

- 原生独立在线 PK：随机红蓝、各自按钮、统一未来时间触发、反应结算、抢跑／平局／超时与异常中止；原同屏、无限、计分、彩头、战报保留。
- 普通邀请、10 分钟分享／8 位邀请码、分享切后台后恢复、第三人占位限制、双方准备。
- 双向确认好友、准确公开账号添加、申请拒绝与撤回、删除、在线好友快捷邀请。好友存入既有私有 Data 仓库，邀请短期存入 DO，业务边界见 [实现说明](ONLINE_DUEL.md)。
- 免费额度优先：按需连接、WebSocket 休眠、空大厅删除 alarm，无 Cron／常驻后台轮询；邀请码惰性过期清理，心跳不逐次写入数据库或重复延期 alarm。本轮未请求升级付费计划。

## 核查与发布阶段

发布前核查已通过：`npm run build` 成功，677 项全量测试与 129 项发布检查全部通过；Worker dry-run 30.16 KiB（gzip 7.83 KiB）。官方微信 CLI 预览编译成功；最终上传与线上联测结果在后续记录中分别确认。

- 本地：构建、全量测试、发布检查、Worker dry-run；真实 workerd 双端／休眠／冷启动／空闲 alarm 与原生分享、好友测试。
- Cloudflare：独立 Worker 与 SQLite DO 已部署；Custom Domain 已启用，DNS 返回 Cloudflare 地址，`/health` HTTPS 200、证书验证结果 0。Worker 及 Pages 的 `DUEL_TICKET_SECRET`、Pages 的 `DUEL_SOCKET_URL` 已加密配置，尚待本轮 Pages 部署及实际 WSS 对局验证。
- 线上：使用本轮独占的临时测试账号验证好友全流程、分享／邀请码、双端对局及异常中止；核查后精确清理当前测试文件，Git 历史保留。公开资源与账号保护分别验证。
- 微信：官方 CLI 预览与上传开发版，记录源码指纹与包体。微信 socket 合法域名由用户配置，双真机声响、体验版、审核和正式版状态分别记录。

## 微信后台需填写

服务器域名 → **socket 合法域名**：`wss://pk.brclio-miniapp.bornforthis.cn`。

账号、好友和资源继续使用既有 `https://pocket.bornforthis.cn` request／downloadFile 合法域名，无需把实时地址添加为业务域名或 web-view 域名。
