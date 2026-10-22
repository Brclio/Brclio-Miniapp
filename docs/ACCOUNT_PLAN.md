# 小程序独立账号与分库存储

2026-10-22：本轮按新指定的两个私有仓库实现小程序自己的账号体系。此前已撤回的跨产品共享账号方案属于历史版本；本方案不访问其他产品的账号后台或用户仓库。源码实现、生产配置、Pages 部署、邮件送达、微信真机登录、小程序上传与正式发布分别验收，配置步骤见 [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md)。

当前 `0.1.3` 在独立账号基础上加入永久会话与操作自动同步；实现和最新发布证据见 [ACCOUNT_SYNC_RELEASE.md](ACCOUNT_SYNC_RELEASE.md)。此前邮箱及微信真实联调证据见 [ACCOUNT_VERIFICATION.md](ACCOUNT_VERIFICATION.md)。

## 注册与登录

- 邮箱注册：邮箱、账号、密码和注册用途的邮箱验证码；成功后建立会话。
- 密码登录：邮箱或账号加密码。
- 邮箱登录：已注册邮箱加登录用途的邮箱验证码。
- 微信登录：原生 `wx.login` 获取临时 code，后端使用本小程序 AppID 与 AppSecret 换取身份；首次创建用户，之后进入同一用户。
- 微信新用户可在登录后验证未被占用的邮箱，同时设置账号和密码，保留用户 ID。已经属于其他用户的邮箱或账号会被拒绝，不自动合并账号。

账号为 4–24 位字母、数字或下划线，以字母开头；账号及邮箱按小写规范化。密码为 8–128 位，不接受控制字符。按仓库所有者明确要求，私有用户库的 `credentials.json` 保存 `passwordPlaintext` 明文字段；登录校验另外使用随机盐与服务端 pepper 的 PBKDF2-SHA256 记录。账号接口、公开资料、本机缓存与前端提示均不包含该明文副本。微信新用户未设置密码时两项均为空。

## 两个固定私有仓库

账号、邮箱、密码校验记录、会话、微信身份索引、验证码与滥用限制记录全部进入 `BrclioData/Brclio-Miniapp-UserData`。应用偏好进入 `BrclioData/Brclio-Miniapp-Data`。所属组织与仓库名由后端固定，客户端不能选择仓库、分支、用户目录或任意路径。

每位用户获得随机的 32 位十六进制 ID，先按前两位分片，再使用独立用户目录。邮箱、账号和微信 openid 不作为文件名。查询索引独立于用户资料，不需要遍历所有用户文件。

```text
Brclio-Miniapp-UserData/
  .brclio-store.json                  # 仅空仓库自动初始化时创建
  users/v1/<ID前两位>/<用户ID>/
    profile.json                     # 邮箱、账号、显示名、来源、状态、时间
    credentials.json                 # 密码明文副本与校验参数；微信新用户为空
    sessions.json                    # 会话摘要及有效期，最多10个有效会话
  indexes/v1/<email|username|wechat>/<摘要前两位>/<HMAC摘要>.json
  challenges/v1/<register|login|bind>/<摘要前两位>/<HMAC摘要>.json
  abuse/v1/<限制类别>/<摘要前两位>/<HMAC摘要>.json

Brclio-Miniapp-Data/
  .brclio-store.json                  # 仅空仓库自动初始化时创建
  users/v1/<ID前两位>/<用户ID>/
    preferences.json                 # revision、更新时间、声音/振动偏好
```

`profile.json` 中的邮箱与账号是业务所需的可读资料。微信 openid 只参与服务端带密钥摘要索引，不原样持久化；微信 `session_key` 与 `unionid` 不入库、不返回客户端。验证码只保存带随机 nonce 的 HMAC 校验记录；IP 只参与带密钥摘要的限流路径，不原样入库。

## 凭据与会话

GitHub App 使用 RS256 JWT 换取短期 installation token，每个 token 再限定到当前操作的一个仓库和 `Contents: write` 权限。私钥、JWT、installation token、邮件凭据和微信 AppSecret 只在后端使用，不随小程序或静态网页发布。

当前 App installation 为 `174043179`，组织 `BrclioData`，安装选择为全部仓库，用户明确授权保留此范围；程序仍仅操作上述两个固定私有仓库并申请单仓库 token。两个仓库默认分支均为 `main`，App 实际读写、回读和删除已验证。

密码校验记录包含算法版本、100,000 次 PBKDF2-SHA256 参数、16 字节随机盐和摘要；密码先经过 `ACCOUNT_HMAC_SECRET` 的 HMAC。该 Secret 也参与身份索引、验证码与限流路径派生，必须稳定保管；直接更换会使原身份索引与密码校验失效，轮换需要专门迁移方案。

会话使用 32 字节随机能力值，仓库只保存 SHA-256 摘要；没有固定到期时间，不因其他设备登录被淘汰；旧带期限会话在认证时兼容迁移。退出立即清除当前本机会话，联网撤销对应服务端会话；断网时持久化待撤销队列，联网后重试。退出不清除挑战、学习进度、收藏或其他本机数据。

## API

原生客户端固定请求 `https://pocket.bornforthis.cn/api/account`。需登录的请求携带自己的 `Authorization: Bearer …`，不用 Cookie。接口不接受查询参数或额外 JSON 字段，响应不缓存。

| 方法与路径 | 请求 | 行为 |
| --- | --- | --- |
| `POST /email/code` | `{email,purpose}`，purpose 为 `register/login/bind` | 发送对应用途验证码；绑定用途须登录 |
| `POST /register` | `{email,username,password,code}` | 注册并建立会话 |
| `POST /login/password` | `{identifier,password}` | 邮箱或账号密码登录 |
| `POST /login/email` | `{email,code}` | 已注册邮箱验证码登录 |
| `POST /login/wechat` | `{code}` | 微信登录或首次注册 |
| `GET /session` | bearer | 当前用户与有效期 |
| `POST /logout` | `{}` + bearer | 注销当前服务端会话 |
| `POST /bind/email` | `{email,username,password,code}` + bearer | 微信用户绑定邮箱、账号和密码 |
| `GET /sync` | bearer | 读取当前账号白名单同步数据与 revision |
| `PUT /sync` | `{revision,entries}` + bearer | 校验白名单并原子合并，冲突返回 409 |
| `GET /data` | bearer | 读取当前用户应用偏好 |
| `PUT /data` | `{revision,preferences}` + bearer | 比较 revision 后更新自己的声音/振动偏好 |

登录只返回安全用户资料、当前会话 token 和 `expiresAt: null`。`/data` 的 `preferences` 只接受 `soundEnabled` 与 `haptics` 布尔值，不上传邮箱、密码、微信身份、照片、对局或学习足迹。新增 `/sync` 通过固定白名单同步操作记录，结构、冲突与断网行为见最新发布文档。数据按已验证用户 ID 定位，拒绝客户端自选用户。偏好写入 revision 冲突返回 `409 data_conflict`，需先重读。

## 校验、并发与限流

验证码为 6 位数字，有效期 10 分钟，只能成功使用一次；注册、登录与绑定用途隔离，每条验证码最多校验失败 5 次。发送间隔 60 秒，同一邮箱/用途/绑定用户的发送窗口最多 6 次/小时；IP 总发送窗口最多 20 次/小时。密码登录同时限制每 IP 30 次/15 分钟、每身份 10 次/15 分钟；注册与绑定共享每 IP 20 次/15 分钟，微信登录每 IP 30 次/15 分钟。

邮件发送在仓库事务之外执行；只有提供方接受请求后验证码才可使用。网络结果不确定时不接受未确认的验证码，也不返回验证码给客户端。SMTP 的 DATA 被接受或邮件 API 返回成功仅表示提供方接收，实际收件箱送达另行验收。Gmail 通过固定 `smtp.gmail.com:465` TLS 连接发送验证码；Resend 作为可选替代提供方。

一次仓库事务固定分支 HEAD，读取验证该快照，将相关文件放入同一个 Git tree 与 commit，以非强制分支引用更新提交。并发冲突重新读取并执行验证，防止同时占用同一邮箱/账号或重复消费验证码。两个仓库之间没有分布式事务；身份和凭据仅在用户库事务内写入，业务偏好和白名单同步文档仅在应用数据仓库内更新。

## 存储与发布边界

GitHub 私有仓库的授权管理者可读取资料、密码明文副本和历史版本。密码校验摘要不保护另行保存的明文副本；仓库权限与备份须严格受控。验证码、限流窗口到期后失效，登录会话由主动退出撤销，但不会自动从 Git 历史擦除。删除当前文件或清空本机数据也不会清除历史提交。

注册、登录、验证码尝试与限流更新可能产生 Git 提交并消耗 GitHub API 配额；流量增长时需评估配额、提交增长与清理安排。当前不创建 R2、KV、D1 或 Durable Object 存储。

摄影、挑战和悦学继续可作为访客使用。旧跨产品会话不用于独立账号，也不自动读取旧共享账号缓存。既有访客业务记录只由首个独立账号领取一次，其他账号与之后的访客记录分别保存。Pages advanced Worker 通过 `web/pages-worker.mjs` 挂载独立账号 API；仅改 `functions/` 不会改变当前 `_worker.js` 构建的路由。
