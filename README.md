# Brclio 悦创

`0.1.12` 微信普通小程序，提供「摄影 / 放松 / 悦学 / 育儿 / 我的」五个原生栏目及博客入口。AppID：`wx59aa532fbf6fa540`；主体：莆田市荔城区黄家蓉宝电脑店。

摄影、挑战与学习界面均使用小程序原生代码，不加载外部网页。摄影包含正确来源 [FirstSight_Online](https://github.com/AndersonHJB/FirstSight_Online) 的 8 组婚纱、1 组孕期影像，共 169 张实际照片；放松提供 ReadyGoDuel 同屏双人反应挑战；悦学接入 [LingoTiles「词了个词」](https://github.com/Brclio/brclio-lingotiles)，保留经典主题与 10 万词分级学习，重新设计手机界面。「我的」支持邮箱验证注册、邮箱验证码登录、邮箱或账号密码登录，小程序另外提供微信一键登录与注册，已有账号登录后可一键绑定微信，后续直接用微信进入同一账号。网页与小程序共用账号，挑战和学习记录先存本机，登录后自动同步。部署与微信发布分别验收。

## 当前实现

`0.1.11` 新增「双人反应 → 在线 PK」独立分包：在线选人、分享邀请、8 位邀请码加入、好友申请确认与在线好友快捷挑战。双方各用自己的手机，只显示自己的随机红蓝触控按钮；校准时间并确认准备后，按共同的未来时间触发开始音与 GO。支持抢跑、平局、超时和再次对战，切后台或断线则中止；分享邀请在开局前保留 10 分钟，返回后可恢复。原同屏触摸、无限、计分、彩头和战报入口保留。

`0.1.12` 修复在线 PK 校准丢包、双方准备时间差引起的误掉线：进入广场持续心跳，断线自动重连，最后一人离开后静默。每台手机准备前先静音预热本机开始音和 GO；音频异常会阻止准备或中止本局。

在线 PK 使用独立实时 Worker 与 Durable Object，账号接口只签发短期连接凭证；好友与可恢复邀请码保存在既有 GitHub 私有业务仓库，Cloudflare 仅暂存当前连接和对局，心跳不写 GitHub。微信 socket 合法域名已由用户配置并核对。准确阶段见 [0.1.12 保活与声音发布记录](docs/ONLINE_DUEL_RELIABILITY_RELEASE.md) 和 [0.1.11 初次发布记录](docs/ONLINE_DUEL_RELEASE.md)，机制与容量见 [实现说明](docs/ONLINE_DUEL.md)。

`0.1.10` 博客缓存与界面改版已部署到网页，微信开发版已上传；614 项测试、121 项发布检查及双域名 22 项本轮线上核验通过。小程序正式版仍待审核发布，详见 [博客发布记录](docs/BLOG_RELEASE.md)；此前 0.1.9 的全量公开资源与生产生命周期核验亦保留在记录中。

- 博客（0.1.10）：网页提供 Markdown 写作、预览、本机草稿恢复、云端草稿、发布/撤回与文章管理；网页与原生小程序共用公开阅读、分类标签搜索、评论、点赞、收藏和每日去重阅读统计。双端采用整宽文章卡、手机底部互动栏和账号隔离的阅读缓存，返回保留筛选与分页，支持主动刷新。使用现有账号；文章、互动和统计采用带版本与严格校验的结构化 JSON，独立保存到 `BrclioData/Brclio-Miniapp-Blog-Data` 私有仓库。管理员邮箱按本次指定配置为 `aiyuechuang@gmail.com`。入口、容量与数据说明见 [BLOG.md](docs/BLOG.md)，本轮上线状态见 [BLOG_RELEASE.md](docs/BLOG_RELEASE.md)。

`0.1.8` 修复原生头像选择网格在小屏下溢出、选中边框过宽和关闭按钮占位问题，见 [布局修复与上传记录](docs/AVATAR_LAYOUT_RELEASE.md)。此前 `0.1.7` 将 1000 个内置头像全部替换为逐张使用 imagegen 生成的独立创意作品，按 20 个主题交错展示。本次核查与发布阶段见 [AVATAR_REDESIGN_RELEASE.md](docs/AVATAR_REDESIGN_RELEASE.md)。此前头像功能见 [AVATAR_RELEASE.md](docs/AVATAR_RELEASE.md)。此前 `0.1.5` 儿歌收藏同步和微信绑定见 [SONG_SYNC_RELEASE.md](docs/SONG_SYNC_RELEASE.md)。

- 育儿（0.1.4）：原生儿歌播放器接入 [Erge-Duoduo](https://github.com/Brclio/Erge-Duoduo) 固定提交的 47 首现有 MP3，直接使用 `erge-duoduo.bornforthis.cn` 音频，不打包音乐或加载网页。每首配有独立生成的 256×256 插画封面，播放器与图片按需加载育儿分包。提供蹦跳／睡前筛选、搜索、收藏、进度拖动、顺序／随机／单曲循环和 15／30／60 分钟前台定时停止。收藏在登录后自动同步；播放模式和最近进度保存在各账号的本机缓存。域名配置建议、来源、后台播放限制与验收边界见 [育儿音乐说明](docs/NURSERY_MUSIC.md)。

- 摄影：全部／婚纱／孕期筛选，9 本相册，原生详情、滑动切图、双击／按钮放大、双指缩放、拖动与关闭。
- 展示图片为本地 JPEG 压缩版本，随四个摄影分包上传；主包包含 9 张封面缩略图。没有远程原图查看或原图网站依赖。
- 照片来自固定提交 `988cc8d0208ac2cae87b0e36b072007a856356ab` 的实际摄影，排除旧仓库样例、重复聚合、模拟 EXIF、信件、留言与视频。169 个上游优化 WebP 共 20,325,346 字节，逐文件校验来源；原始大 JPG 不修改、不随包发布。
- ReadyGoDuel：以原作固定提交 `e3efd5f3c1f40ac780cce0ff170b904922b1acf5` 恢复触摸、无限模式，以及开始／GO／抢跑／胜利音效、彩头分类与自定义、标题／玩家名／等待时间设置和 PNG 战报；按用户本次确认移除不够准确的声控模式及其录音／回放；逐项实现与验收状态见 [功能对照](docs/READY_GO_DUEL_PARITY.md)。保留的 1／3／5 分、近同时触碰平局、超时、后台暂停与最近 20 场本机记录属于另选的计分扩展；这些计分记录继续保存在本机。
- 头像设置（0.1.7 全新创意库）：账号从 1000 张独立生成的 AI 创意头像中随机分配并保留，网页和小程序支持分页选择、随机更换或上传自定义头像；所选原图（最大 10 MB）与 256×256 压缩展示图存入现有私有账号仓库。见 [头像实现与验收](docs/AVATARS.md)。
- 小程序对局与战报按 Brclio Design System 重设计，采用原生导航、上下对坐触控区与底部操作面板，适配 320×568 和 390×844 手机。单局／总战报使用用户提供的 Brclio 悦创真实小程序码；独立网页保留原作视觉。
- 悦学：固定 LingoTiles 提交 `a6a3841b846d72932301d43ddb9c30e756a22c7b`，保留六个经典主题共 54 个精选词、10 万唯一英文词条、三牌配对、七格暂存槽、撤回／提示／洗牌、暂停、合成与收获、单词本、收藏、逐次足迹及 CSV 导出。54 个精选词已计入 10 万词。1,083 个现有插图义项及索引按原字节保留，98,917 个待配图义项继续用文字展示；来源快照 1,454 个文件已逐项核对 Git blob 哈希。经典六关及仅含内置经典词的收藏页可离线使用；混合分级词的收藏页需联网，失败可重试。分级词库和图片按选择联网读取。功能与待真机项目见 [LingoTiles 功能对照](docs/LINGOTILES_PARITY.md)。
- 摄影、挑战和悦学无需登录；可在「我的」注册或登录本小程序独立账号，微信新用户可绑定邮箱与账号。不申请微信头像、手机号、相机、麦克风或定位权限；仅主动选择微信登录时调用 `wx.login`。主动保存战报到相册时才请求相册写入权限。
- 2026-10-22 新建独立账号后端 `/api/account/*` 并部署到 Pages，不转发其他产品账号服务。用户资料、凭据、会话和验证码存入指定私有仓库 `BrclioData/Brclio-Miniapp-UserData`；业务偏好 API 使用 `BrclioData/Brclio-Miniapp-Data`。每位用户按随机 ID 分片并拥有独立目录。密码按所有者要求仅在私有用户凭据文件保存明文副本，登录使用带随机盐与服务端 pepper 的校验记录；验证码有时效、用途与尝试次数限制。生产真实邮箱注册、邮箱密码、账号密码、邮箱验证码登录与隔离测试通过；用户后台截图已确认服务器域名与 AppID，19:20 执行官方 CLI 网络缓存清理并完整退出重启后，19:21 原生微信一键登录成功；退出后再次微信登录已实测复用同一用户，微信账号邮箱绑定仍待实际提交验收。账号设计及配置见 [ACCOUNT_PLAN.md](docs/ACCOUNT_PLAN.md) 与 [ACCOUNT_SETUP.md](docs/ACCOUNT_SETUP.md)。

主包及每个分包均检查低于 2 MiB。首次获取和更新小程序／分包仍需要微信正常联网；代码包获取后，日常原生摄影与同屏挑战不请求外部照片网站或 API。在线 PK 持续使用实时连接；悦学分级词库、词义插图和主动发音需要联网；访客学习记录先存本机，登录后自动同步进度、收藏及最近 200 条通关足迹。独立网页保留 ReadyGoDuel 原作 PV 统计请求，网络与权限范围见各模块功能对照。

## 开发与构建

```sh
npm ci
npm run build
npm test
npm run check:release
npm run wechat:open
```

微信开发者工具导入项目根目录，`compileType` 为普通小程序，代码目录为 `miniprogram/`。`npm run build` 离线生成共享挑战模块、摄影分包页面和数据、LingoTiles 原生规则与网络／本机存储适配，再构建独立网页。LingoTiles 的 `public/vocabulary` 与 `public/images` 随网页复制到同域项目路径，未塞入微信主包。旧 `/pages/web/index?id=…` 分享入口仅按白名单跳转到原生页面，不包含 web-view。

更新摄影时：

```sh
# 显式联网，用现有 gh 认证精准读取固定私有源 blob；不克隆含 node_modules 的整个仓库。
npm run sync:firstsight
# macOS sips 生成本地展示图、封面与分包；原图不改动。
npm run prepare:photos
npm run build
npm test
npm run check:release
```

词了个词会继续从原仓库维护更新：`npm run sync:lingotiles -- --ref main` 检查差异，用报告中的完整 SHA 加 `--apply` 才同步全部源码、词库与插图。网页适配由补丁生成，原生功能变化有审查门禁，避免后续漏接新功能。操作与回退步骤见 [持续更新流程](docs/LINGOTILES_UPDATES.md)。

正常构建只读取本地摄影素材、来源清单、原生展示文件和固定 LingoTiles 源码／资源，不需要 GitHub token 或网络。首次安装构建依赖及补全来源资源是独立的联网步骤。增加来源提交须先审查源数据和固定提交，不能直接把仓库内所有素材视为应发布内容。摄影来源见 [SOURCE.md](web/projects/firstsight/SOURCE.md)，学习来源与资源边界见 [LINGOTILES_PARITY.md](docs/LINGOTILES_PARITY.md)。

## 独立网页

同一工程保留独立网页，当前构建登记 FirstSight 摄影、ReadyGoDuel 反应挑战和 LingoTiles 学习三个模块。入口域名如下；本次新增悦学的实际部署状态见验证记录：

- [pocket.bornforthis.cn](https://pocket.bornforthis.cn)
- [pocket.brclio.com](https://pocket.brclio.com)

网页 [我的账号](https://pocket.bornforthis.cn/?category=mine) 提供邮箱、账号、密码、邮箱验证码注册，以及邮箱验证码、邮箱密码和账号密码登录。网页与原生共用 `/api/account/*` 及永久会话协议；微信创建的账号可在小程序绑定邮箱后登录网页。登录会保持到主动退出，同一账号的挑战设置、计分战绩、学习进度、收藏和最近 200 条通关记录互通。访客记录仅由首个登录账号接续一次，不同账号的本机记录及通关数据库分别保存；离线操作在联网后重试。模块页有折叠的账号与同步入口，游戏开始后不会被迟到的云端响应覆盖。实现与本轮网页验收见 [WEB_ACCOUNT_RELEASE.md](docs/WEB_ACCOUNT_RELEASE.md)。

```sh
npm run dev:web
npm run deploy
```

网页构建目标为 Pages 项目 `brclio-miniapp-wechat`，与微信原生页面独立。ReadyGoDuel 默认网页使用原 React 界面，计分扩展另设入口；保留原作的 PV 计数脚本；战报二维码使用原图片的本地副本。LingoTiles 网页与原生页均重新适配手机，词库和现有插图从 `/projects/lingotiles/` 按需读取。网页与小程序均移除声控、麦克风采集、录音和录音回放。已停用的 AI 婚纱示例模块不构建、不公开；旧记录 API 仍返回 503。

小程序不需要 web-view 业务域名。独立账号 API 使用同域 `/api/account/*`；悦学资源使用同域 `/projects/lingotiles/vocabulary/…` 和 `/projects/lingotiles/images/…`；原生发音经 `/api/lingotiles/pronounce?word=…` 固定代理有道词典语音，只在主动点击发音或开启消除朗读时发送当前英文单词。微信生产使用需同时配置 **request 与 downloadFile 合法域名 `pocket.bornforthis.cn`**，并核对小程序备案。词库加载与朗读请求不上传收藏、学习进度或通关足迹；学习不依赖登录；登录后的同步使用同域账号 API，数据先存本机，联网后重试。

## 发布与维护

当前准确状态见 [VERIFICATION.md](docs/VERIFICATION.md)，发布步骤见 [RELEASE.md](docs/RELEASE.md)。开发包上传、网页部署、微信审核与正式发布分别记录。内置竞技玩法仍须按实际内容核对微信类目，不能仅凭「放松」栏目名称推断可审核通过。

`0.1.4` 育儿栏目、47 首儿歌与独立封面的核查和发布状态见 [NURSERY_RELEASE.md](docs/NURSERY_RELEASE.md)。封面生成使用内置 `image_gen`，逐首提示词与压缩记录见 [封面清单](design/nursery-covers/manifest.json)。

此前 `0.1.3` 已提交 GitHub、部署 Pages 并上传微信开发版。账号支持永久登录至主动退出、操作后自动同步、断网重试与账号隔离；业务数据使用指定私有 Data 仓库，账号凭据使用独立 UserData 仓库。此前实际证据见 [ACCOUNT_SYNC_RELEASE.md](docs/ACCOUNT_SYNC_RELEASE.md)，初次账号联调历史见 [ACCOUNT_VERIFICATION.md](docs/ACCOUNT_VERIFICATION.md)。微信审核与正式发布另行记录。

```text
miniprogram/pages/          原生首页、图库、挑战、悦学、育儿、关于、隐私与旧链接转接
miniprogram/photo-*/        自动生成的摄影分包：相册页、本包数据、展示图片
miniprogram/nursery/        育儿分包：原生音乐播放器、47 张压缩歌曲封面
miniprogram/data/           原生目录与图片来源清单
native/album/              原生相册页唯一维护模板
minigame/lib/              共享挑战逻辑与本机存储
scripts/                  摄影导入、分包构建、网页构建与发布检查
web/projects/firstsight/    正确摄影来源快照、优化 WebP 与网页适配
web/projects/lingotiles/    固定学习来源、原生规则基线、词库、插图与手机网页适配
web/portal/                独立网页门户
```

署名与使用范围见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。联系邮箱：aiyuechuang@gmail.com。
