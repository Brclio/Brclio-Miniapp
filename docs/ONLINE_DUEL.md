# 双人反应挑战 · 在线 PK

本次增加独立的原生「在线 PK」分包。原有同屏双人、无限挑战、计分挑战、设置、彩头、音效、PNG 战报和本机／账号同步继续走原来的逻辑。在线对战不改写这些设置，也不把在线结果混入原有同屏战绩。在线声音首次沿用已有声音偏好，之后的开关独立保存在本机。

## 玩法

1. 双方先登录，在各自手机进入「双人反应挑战 → 在线 PK」。大厅只显示主动进入在线 PK 的用户；登录本身不会公开在线状态。
2. 选择一位空闲用户发出邀请，对方接受后进入房间；普通邀请 30 秒过期。也可创建 10 分钟有效的 8 位邀请码，直接分享 PK 页面或让对方手填加入；第一个加入者占位，第三人无法加入。分享时房主切后台不会取消尚未开局的邀请，双方重新在线后自动配对。
3. 好友列表支持通过准确公开账号或在线用户发出申请，对方接受后互相成为好友。好友只有进入在线 PK 时才显示在线，可直接邀请；好友列表按进入／手动刷新读取，没有后台轮询。
4. 接受后服务器随机分配红蓝，双方各自只出现自己的一个大按钮。双方都点击准备后，才进行这一轮。
5. 双方校准时钟、确认已收到未来开局计划，再进入等待。服务器生成相同的开局时间与随机信号时间，两端按本地校正后的时间触发开始音、GO 音与画面。
6. GO 后 5 秒内点击自己的按钮。抢跑判负，反应相差 20ms 以内为平局，双方均未点击则超时无胜者；一人正常点击而另一人超时则已点击者胜。
7. 一轮结束后双方重新准备可继续，阵营保持不变。退到后台、断线、离开或同步失败会中止正在进行的一轮，不据此奖励胜场。返回大厅可换对手。

该设计对齐的是双方的目标播放时间。手机音频硬件、微信调度和系统负载仍会产生实际声响差异，不能承诺物理层面零毫秒偏差。网络或定时器状态明显异常时中止并重试。建议双方使用扬声器与稳定网络，并保持小程序在前台。

## 同步与判定

- 客户端采样 5 次往返探测，以较低延迟样本估算服务器时差。准备前校验样本时效；倒计时期间冻结时差，避免音效时间跳动。
- 服务器同时测量 pong → probe_ack 的往返时间。准备需要最近 15 秒内的服务器探测、服务器 RTT 不超过 400ms，客户端报告 RTT 不超过 300ms、时钟不确定度不超过 150ms。先准备者等待超过 10 秒需重新准备，防止继续复用过期测量。
- 双方准备后，`startAt = serverNow + 2000`，`signalAt = startAt + random(2000..6000)`。先发送 `arming`，双方在 `startAt - 300` 前确认 `armed` 后才提交 `scheduled`；缺少任一确认即中止。
- 按下时提交 `roundId` 和相对于本机实际触发 GO 回调的 `reactionMs`，触发前点击使用负数代表抢跑。轻微定时延迟不计入反应耗时；回调迟到超过 120ms 则中止。服务器锁定每位玩家的第一次合法点击，拒绝旧轮次，按反应时间比较，避免由谁的网络包先到决定胜负。
- 服务器把报送反应时间与实际到达时间、实测 RTT、时钟不确定度核对；误差超过限定窗口就中止，无胜者。双方均有反应则立即结算；否则在 GO 后 5500ms 结算，包含最多 500ms 传输余量。
- 这是一款休闲对战。客户端时间不构成可信硬件证明，延迟校验可以拒绝明显异常，不能彻底消除篡改客户端或预知计划时间带来的作弊。因此本次不增加竞技排名、奖励交易或公开胜率榜。

## 服务与数据边界

现有 Cloudflare Pages 账号服务增加 `POST /api/account/duel-ticket`，复用已有账号会话，以只读方式检查私有 UserData 仓库中的账号和会话。接口返回一个 60 秒有效、仅用于建立对战连接的 HMAC 签名票据，不向 WebSocket 服务传送长期账号 token、邮箱、密码或微信身份。票据含随机用户 ID、展示名和展示头像 URL；头像访问方式沿用现有账号功能。

新建的 `realtime/` Worker 提供 `/connect` 与 `/health`。一个 `DuelLobby` Durable Object 原子协调在线用户、邀请和房间，当前上限 100 位同时在线用户。每个账号只保留一个活动连接；其他设备重新进入会结束原连接。大厅心跳间隔 10 秒，35 秒无消息清理；正在同步开局或对局时改为每秒心跳，3 秒无消息即中止。这样能较早发现静默断网，结算前已确认的断线不会算成输赢；刚发生、尚未达到心跳截止时间的断网仍存在检测延迟。30 秒邀请、心跳清理与对局截止时间均通过 DO alarm 调度，空大厅删除 alarm。

Worker 使用 WebSocket Hibernation。活动连接附件只暂存当前房间、邀请快照、探测和在线状态，唤醒后恢复，不保存历史战绩。为了分享切后台、断开及冷启动恢复，邀请码与参与者展示资料持久保存在既有 GitHub 私有业务仓库，Cloudflare DO 不保存这些业务文件；仅保留 alarm 调度元数据。邀请码开局或取消时删除当前记录，过期后不能加入、后续相关访问惰性清理，Git 历史可能保留旧版本。心跳和点击不读写 GitHub，正式开局前完成必要的邀请写入，避免把仓库网络延迟带入对局。

邀请码使用 `BrclioData/Brclio-Miniapp-Data` 的 `realtime/v1/invites/<邀请码>.json` 和 `users/v1/<前缀>/<账号ID>/duel-invite.json`；记录和双方索引同一事务更新。实时 Worker 使用现有 GitHub App 的服务端加密配置访问该固定私库，要求验证仓库为 private，未新增业务仓库。旧 DO 邀请如存在，先提交此私库再清理旧副本；失败时不丢弃旧记录。

好友关系、申请和限流记录按账号目录写入既有私有业务仓库 `BrclioData/Brclio-Miniapp-Data` 的 `users/v1/<前缀>/<账号ID>/friends.json`。双方文件通过一次乐观并发事务共同更新。仅保留公开账号、随机账号 ID、昵称、头像和关系时间，不含邮箱、会话或微信标识；好友 100 位、待处理申请 50 条、每日最多 20 条新申请，申请 7 天过期。删除／撤回会更新当前关系，Git 历史仍可能保留旧记录。离线好友资料为上次互动时的展示快照，在线时合并实时大厅资料。

WebSocket 不使用浏览器 cookie。允许无 Origin 的原生请求，以及现有两个 pocket 域名和 `https://servicewechat.com`；每次建立连接仍必须验证短期签名票据。不要在访问日志或错误报告中保存带票据的完整连接 URL。

## 配置与发布

本轮由用户授权直接上线。准确的部署、域名证书、线上联测及微信开发版状态见 [0.1.11 发布记录](ONLINE_DUEL_RELEASE.md)。配置如下：

1. 实时自定义域名为 `pk.brclio-miniapp.bornforthis.cn`，使用 Worker Custom Domain 自动配置 DNS 和此多级域名的 TLS 证书，`workers_dev: false`。
2. 为实时 Worker 配置 `DUEL_TICKET_SECRET`（至少 32 个随机字符），部署该 Worker 与 `DuelLobby` SQLite migration。该 secret 只在服务端保存。
3. 在账号 Pages 环境配置相同 `DUEL_TICKET_SECRET` 和 `DUEL_SOCKET_URL=wss://pk.brclio-miniapp.bornforthis.cn/connect`，构建部署账号 Pages。未配置时 `/duel-ticket` 返回可理解的「在线 PK 尚未开放」，同屏玩法正常。
4. 在微信小程序后台的 **socket 合法域名** 添加 `wss://pk.brclio-miniapp.bornforthis.cn`；原有账号 `request` 合法域名保持现有配置。更新开发版／体验版，分别用 iOS 和 Android 真机验证邀请、同步声响、抢跑、超时、切后台与断网恢复。
5. 真机通过后按现有微信审核与发布流程推进；Worker 部署、Pages 部署、开发版上传、体验版真机核验、审核和正式版发布分别记录。

开发示例变量在根目录与 `realtime/.dev.vars.example`。本地构建不需要实时服务凭据。

```sh
# 只构建校验，不创建外部资源
npx wrangler deploy --dry-run --config realtime/wrangler.jsonc --outdir /tmp/brclio-duel-worker-dry-run

# 本地服务；使用忽略提交的 realtime/.dev.vars 中的开发 secret
npx wrangler dev --config realtime/wrangler.jsonc
```

## 协议 v1

WebSocket 消息为 JSON，输入单条上限 4096 字符，每用户每 5 秒最多 60 条；最多保留 8 个未完成服务器探测。服务器消息带 `serverAt`。

| 方向 | type | 主要字段 |
| --- | --- | --- |
| 客户端 → 服务端 | ping | id、clientAt |
| 服务端 → 客户端 | pong | id、clientAt、serverAt、probeId |
| 客户端 → 服务端 | probe_ack | probeId，收到 pong 后立即发送 |
| 服务端 → 客户端 | hello | user: id、displayName、avatarUrl |
| 服务端 → 客户端 | lobby | users: id、displayName、avatarUrl、status（available / busy） |
| 客户端 → 服务端 | invite | userId |
| 客户端 → 服务端 | accept / decline / cancel | invitationId；仅目标用户可接受／拒绝，仅发起者可取消 |
| 服务端 → 客户端 | state | room 或 null，invitation 或 null；仅发给当前用户 |
| 客户端 → 服务端 | create_code / join_code / cancel_code | 创建分享邀请码／以 code 加入／取消预开局预约 |
| 客户端 → 服务端 | ready | rtt、uncertainty |
| 客户端 → 服务端 | armed | roundId |
| 客户端 → 服务端 | tap | roundId、reactionMs；每人每轮首条合法点击有效 |
| 客户端 → 服务端 | leave | 离房／取消邀请，连接仍在可返回大厅 |
| 服务端 → 客户端 | error | code、message |

`room` 包含 `id / players / phase / ready / roundId / startAt / signalAt / result`。玩家含 `color: red | blue`；房间阶段为 `ready / arming / scheduled / finished / aborted`。结果含 `reason / winnerId / reactions / message`，未产生胜者时 `winnerId: null`。发送结算前不向对手公开未判定的点击数据。

## 本地验证

2026-10-28 本地结果：`npm run build` 成功；`npm test` 647 项全部通过；`npm run check:release` 128 项全部通过。在线分包 25.3 KiB，主包 1593.4 KiB，均低于 2 MiB。实时 Worker 构建 dry-run 与真实 workerd 双连接测试通过。320 与 390 宽度页面仅做 HTML 布局模拟检查，不能替代微信原生或真机验收。

以上为第一阶段本地结果，本轮扩展后的最终验证与发布阶段见 [0.1.11 发布记录](ONLINE_DUEL_RELEASE.md)。

- `tests/online-duel-backend.test.js`：邀请权限／过期／占用、随机阵营、测时门槛、双确认、反应先后、抢跑／平局／超时、首击不可覆盖、异常延迟、断线、心跳、休眠附件重建、票据签名和账号只读鉴权。
- `tests/online-duel-worker.test.js`：真实 Miniflare/workerd 中两条 WebSocket 完成邀请与准备，拒绝无效签名、错误 Origin 和普通 HTTP；强制两次 hibernate，验证确认和开局时间经附件恢复，断开连接后无胜者中止。
- 原生客户端及两手机模拟见同目录 `online-duel-client`、`online-duel-integration` 与 `native-online-duel-page` 测试。真实手机声响偏差和微信 socket 合法域名仍须上线环境验收。

Cloudflare 生命周期与接口依据：[WebSocket Hibernation 文档](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)、[Durable Object state](https://developers.cloudflare.com/durable-objects/api/state/)。

## 免费额度与按需运行

只有主动进入在线 PK 才连接 WebSocket。大厅每 10 秒心跳，开局和对局每秒心跳以尽快发现失联；退出页面立即断开。使用 WebSocket Hibernation，无常驻 setInterval 或 Cron，无用户时删除 alarm，离线邀请码按下一次访问惰性清理。好友列表不自动轮询，`/health` 不访问 DO。

使用免费计划支持的 SQLite Durable Object，本轮不升级任何付费计划。免费额度按 Cloudflare 账号共享，并非无限量：DO 每日 100,000 计费请求、13,000 GB-s、100,000 写入行、5,000,000 读取行；超限的免费计划操作会失败，不能以空闲休眠保证任意访问量永远免费。[官方额度与休眠规则](https://developers.cloudflare.com/durable-objects/platform/pricing/)。多级 Custom Domain 会自动取得覆盖该主机的证书，无需另订 Advanced Certificate Manager：[官方证书说明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/#certificates)。
