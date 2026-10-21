# Brclio 悦创

`0.1.0` 微信普通小程序，以摄影为主题，提供「摄影 / 放松 / 我的」三个原生入口。AppID：`wx59aa532fbf6fa540`；主体：莆田市荔城区黄家蓉宝电脑店。

摄影与游戏均直接内置于小程序代码，不加载外部网页。摄影包含正确来源 [FirstSight_Online](https://github.com/AndersonHJB/FirstSight_Online) 的 8 组婚纱、1 组孕期影像，共 169 张实际照片；放松提供 ReadyGoDuel 同屏双人反应挑战。「我的」新增可选的 Brclio 共享账号和手动挑战备份；本次为源码接入，发布状态另行验收。

## 当前实现

- 摄影：全部／婚纱／孕期筛选，9 本相册，原生详情、滑动切图、双击／按钮放大、双指缩放、拖动与关闭。
- 展示图片为本地 JPEG 压缩版本，随四个摄影分包上传；主包包含 9 张封面缩略图。没有远程原图查看或原图网站依赖。
- 照片来自固定提交 `988cc8d0208ac2cae87b0e36b072007a856356ab` 的实际摄影，排除旧仓库样例、重复聚合、模拟 EXIF、信件、留言与视频。169 个上游优化 WebP 共 20,325,346 字节，逐文件校验来源；原始大 JPG 不修改、不随包发布。
- ReadyGoDuel：以原作固定提交 `e3efd5f3c1f40ac780cce0ff170b904922b1acf5` 恢复触摸、无限模式，以及开始／GO／抢跑／胜利音效、彩头分类与自定义、标题／玩家名／等待时间设置和 PNG 战报；按用户本次确认移除不够准确的声控模式及其录音／回放；逐项实现与验收状态见 [功能对照](docs/READY_GO_DUEL_PARITY.md)。保留的 1／3／5 分、近同时触碰平局、超时、后台暂停与最近 20 场本机记录属于另选的计分扩展；登录后可手动备份或恢复这些计分记录，确认覆盖预览后才写入。
- 小程序对局与战报按 Brclio Design System 重设计，采用原生导航、上下对坐触控区与底部操作面板，适配 320×568 和 390×844 手机。单局／总战报使用用户提供的 Brclio 悦创真实小程序码；独立网页保留原作视觉。
- 账号支持邮箱验证码注册、账号或邮箱加密码登录、资料设置、密码修改和退出；不申请微信头像、手机号、相机、麦克风或定位权限。主动保存战报到相册时才请求相册写入权限。
- 共享数据仓库为 `BrclioData/BrclioUserData`。用户资料与备份为明文，包含用户密码；每用户独立目录，挑战数据位于 `users/<id>/apps/miniapp/data.json`。GitHub token 仅由中央账号服务持有，小程序和 Pages 代理均不需要 PAT。

主包及每个分包均检查低于 2 MiB。首次获取和更新小程序／分包仍需要微信正常联网；代码包获取后，日常原生浏览和挑战不请求外部照片网站或 API；账号与手动备份需要联网。独立网页保留原作 PV 统计请求，网络与权限范围见功能对照。

## 开发与构建

```sh
npm ci
npm run build
npm test
npm run check:release
npm run wechat:open
```

微信开发者工具导入项目根目录，`compileType` 为普通小程序，代码目录为 `miniprogram/`。`npm run build` 离线生成共享游戏模块、摄影分包页面和数据，再构建独立网页。旧 `/pages/web/index?id=…` 分享入口仅按白名单跳转到原生页面，不包含 web-view。

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

正常构建只读取已提交的摄影素材、来源清单与原生展示文件，不需要 GitHub token 或网络。增加来源提交须先审查源数据和固定提交，不能直接把仓库内所有素材视为应发布内容。详细来源见 [SOURCE.md](web/projects/firstsight/SOURCE.md)。

## 独立网页

同一工程保留公开网页，包含 FirstSight 摄影和反应挑战两个已开放模块：

- [pocket.bornforthis.cn](https://pocket.bornforthis.cn)
- [pocket.brclio.com](https://pocket.brclio.com)

```sh
npm run dev:web
npm run deploy
```

网页构建目标为 Pages 项目 `brclio-miniapp-wechat`，与微信原生页面独立。ReadyGoDuel 默认网页使用原 React 界面，计分扩展另设入口；保留原作的 PV 计数脚本；战报二维码使用原图片的本地副本。网页与小程序均移除声控、麦克风采集、录音和录音回放。已停用的 AI 婚纱示例模块不构建、不公开；旧记录 API 仍返回 503。小程序当前无需配置 web-view 业务域名；账号 API 固定使用 `https://pocket.bornforthis.cn/api/account/*`；上线前仍需在微信后台核对该域名的 request 合法域名配置与小程序本身备案。

## 发布与维护

当前准确状态见 [VERIFICATION.md](docs/VERIFICATION.md)，发布步骤见 [RELEASE.md](docs/RELEASE.md)。开发包上传、网页部署、微信审核与正式发布分别记录。内置竞技玩法仍须按实际内容核对微信类目，不能仅凭「放松」栏目名称推断可审核通过。

共享账号协议与数据恢复边界见 [ACCOUNT_PLAN.md](docs/ACCOUNT_PLAN.md)，账号代理的 Pages 部署和真实隔离测试账号联调记录见 [VERIFICATION.md](docs/VERIFICATION.md)。ReadyGoDuel 原生改版本轮完成自动测试、本地网页与微信开发者工具模拟器流程检查，详情见功能对照；此次原生改版未单独执行 Pages 部署或上传新的微信开发包，微信审核与正式发布仍分别验收。

```text
miniprogram/pages/          原生首页、图库、挑战、关于、隐私与旧链接转接
miniprogram/photo-*/        自动生成的摄影分包：相册页、本包数据、展示图片
miniprogram/data/           原生目录与图片来源清单
native/album/              原生相册页唯一维护模板
minigame/lib/              共享挑战逻辑与本机存储
scripts/                  摄影导入、分包构建、网页构建与发布检查
web/projects/firstsight/    正确摄影来源快照、优化 WebP 与网页适配
web/portal/                独立网页门户
```

署名与使用范围见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。联系邮箱：aiyuechuang@gmail.com。
