# 育儿栏目音乐接入

2026-10-24：已实现登录后的儿歌收藏同步，以及账号密码登录后的微信一键绑定。最终本地 `npm run build`、`npm test`（477/477）和 `npm run check:release` 均通过。本轮未部署 Pages、上传微信代码或进行微信真机验收，线上仍需发布对应后端与小程序版本后验证。

## 数据来源与远程资源

- 来源仓库：[Brclio/Erge-Duoduo](https://github.com/Brclio/Erge-Duoduo)。
- 固定来源提交：[`7de01bfb01e4893bff1299701861bf124f20957c`](https://github.com/Brclio/Erge-Duoduo/commit/7de01bfb01e4893bff1299701861bf124f20957c)。
- 原始元数据：该提交的 `歌曲清单.csv`，blob SHA 为 `195a7be165fc503dce6d1dee24a7f11875175aac`。
- 音频地址：`https://erge-duoduo.bornforthis.cn/` 加逐文件 `encodeURIComponent` 编码后的原始文件名。
- 静态目录在 `miniprogram/data/nursery-songs.js`，保留来源歌曲 ID、顺序、原名、歌手、精确时长、文件字节数、SHA256 与 Git blob SHA。小程序包不包含 MP3，也不在启动时请求远程目录。
- 来源共 50 条记录，只有 47 个已下载文件。“我是挖掘机”“健康歌”“小兔子乖乖”标记为待补充，未加入可播放列表。
- `sleep` 包含“小星星”“虫儿飞（哄睡版）”“小宝贝快快睡”“摇篮曲（哄睡版）”；其余为 `active`。场景是本栏目编辑分类，不是上游元数据。

站点根路径当前返回 404；这不影响原文件名对应的 MP3 直链。不要将根路径 HTML 或 M3U8 当作音乐目录。

## 原生播放与页面生命周期

`0.1.4` 的播放器页面为 `/nursery/pages/player/index`，与 47 张封面一起放入 `nursery` 分包；首页使用原生 `navigateTo` 进入。旧 `/pages/parenting/index` 保留为兼容分享入口，只接受已知场景与歌曲 ID，然后转接新页面。

`miniprogram/lib/nursery-audio.js` 优先使用 `wx.getBackgroundAudioManager()`，原生管理器不可用时降级到 `wx.createInnerAudioContext()`。页面通过 `getNurseryAudio()` 取得应用内单例，通过 `subscribe()` 订阅；离页只取消订阅，避免停止背景播放。`inner` 降级不具备背景播放保证。

官方要求在赋 `src` 之前设置必填的 `title`；设置新的 `src` 会自动开始播放。因此恢复最近曲目、打开分享歌曲以及普通 `select()` 都只更新选择状态，不创建管理器、不赋 `src`。用户主动点击播放才加载远程音频。状态由原生 Play、Pause、Waiting、Ended、Stop、Error、TimeUpdate 等事件更新。

播放服务支持指定队列、上一首/下一首、顺序/随机/单曲循环、进度跳转与睡眠定时。手动下一首可以离开单曲循环，随机上一首返回本次播放历史；自然播放结束才执行单曲重复。顺序队列播放至末尾后回到第一首。

歌曲收藏独立存于 `brclio.nursery-favorites.v1`，内容为 `{favorites: [歌曲 ID]}`。访客收藏先保存在本机，首个登录账号接续一次；登录后使用现有 `/api/account/sync` 保存至指定私有 Data 仓库，操作后自动同步，断网后保留待同步增删操作。多设备合并按实际点击的歌曲收藏或取消意图处理，避免旧歌单快照恢复已取消的收藏。已有本机收藏在升级时迁移，已领取访客数据的账号仅由原账号接续。

最近歌曲、进度和模式仍存于本机 `brclio.nursery-music.v1`，按账号隔离，不上传云端；恢复后不自动播放。切换账号暂停旧账号播放，读取新账号本机状态；同一账号的云端收藏更新不会跳动歌曲、进度或播放模式。播放器进入前台时拉取收藏，离页仍可继续播放并提交待同步操作。存储失败不会中断播放，`storageNotice` 会提示进度/收藏可能无法跨次保留。

## 小程序后台与域名验收

1. `app.json` 需要 `requiredBackgroundModes: ["audio"]`。官方说明开发版、体验版可直接生效，正式版还需审核；本地声明不能证明审核通过。
2. 资源使用 HTTPS。当前实现没有 `wx.request`、`wx.downloadFile` 或网页 `web-view`，因此不是通过“业务域名”打开站点。若后续增加下载，必须按 `wx.downloadFile` 的规则配置下载合法域名；若增加远程目录请求，则需要相应 request 合法域名。
3. 当前核对的 BackgroundAudioManager API 页面没有明确说明 `src` 与服务器合法域名校验的对应关系，不能以桌面 HTTP 成功推导真机免配置。上线前在公众平台核对 `erge-duoduo.bornforthis.cn` 的域名配置，并关闭开发工具/手机的“跳过域名校验”后验收。网络文档对服务器域名另有 HTTPS、证书与 ICP 备案要求；本次未改动公众平台后台配置。
4. 官方明确：切到后台时已开始的音频可继续，但后台不能通过 API 操纵音频播放状态。因此后台自动换曲、锁屏操作、定时暂停的可用性不能由单元测试保证。定时器使用绝对截止时间，前台定时回调、原生进度事件和回前台事件都会检查是否到期；微信冻结 JavaScript 或限制后台 API 时，仍可能延迟到再次允许执行时才暂停。需要严格准点停止时应保持小程序前台。

官方参考：

- [wx.getBackgroundAudioManager](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/wx.getBackgroundAudioManager.html)
- [BackgroundAudioManager 属性与事件](https://developers.weixin.qq.com/miniprogram/dev/api/media/background-audio/BackgroundAudioManager.html)
- [app.json / requiredBackgroundModes](https://developers.weixin.qq.com/miniprogram/dev/reference/configuration/app.html#requiredBackgroundModes)
- [网络与服务器域名](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)

## 验证记录与复跑

2026-10-23 14:13:43（Asia/Shanghai），47/47 个实际音频 URL 全部通过：

- HEAD 返回 200，`Content-Type: audio/mpeg`，`Content-Length` 与固定来源 CSV 的字节数一致。
- `Accept-Ranges: bytes`。
- `Range: bytes=0-15` 返回 206，`Content-Range` 为实际字节数，前 16 字节有 MP3/ID3 签名。
- 完整 GET 逐首流式计算 SHA256 与实际字节数，均与固定来源清单一致；没有保存或修改音频。

完整核验报告为本地 `artifacts/nursery-covers/audio-full-sha256.json`。默认网络检查仅请求响应头与前 16 字节；显式 `--full` 才检查全部音频字节。

```sh
node --test tests/nursery-audio.test.js tests/nursery-account-sync.test.js
node scripts/check-nursery-music.js
node scripts/check-nursery-music.js --full
```

自动化测试覆盖来源目录、恢复/分享不自动播放、原生状态/错误/重试、队列与随机历史、seek、绝对时钟定时、取消订阅后播放、存储失败、音频降级和释放。网络脚本是独立可选检查，不放入离线测试。

仍需使用实际 AppID 在 iOS 与 Android 保持域名校验开启时验证：播放/暂停、后台持续播放、自然跨曲、系统上一首/下一首、锁屏、耳机控制、网络断开/恢复、来电中断与恢复、后台定时到期、恢复最近进度、正式版背景音频审核状态。

## 独立歌曲封面

47 首歌曲各使用一次内置 `image_gen` 生成独立插画，没有使用 CLI/API 回退或网格切图。完整提示词、生成输出标识、原图和成品 SHA256 见 [封面清单](../design/nursery-covers/manifest.json)。原始 PNG 在本机 `artifacts/nursery-covers/originals/` 归档，不进入 Git 或小程序包。

成品为 `miniprogram/nursery/assets/covers/<ID>.jpg`，256×256 渐进式 JPEG，整套 570,808 字节，单张 6,718–17,167 字节。播放器、列表与底部小播放器读取分包图片；图片失败时显示占位，不影响音频。系统播放器按歌曲使用 `https://pocket.bornforthis.cn/assets/nursery-covers/<ID>.jpg`，网页构建复制完全相同的字节。选择歌曲和打开分享不会自动播放或请求远程音频。

可运行 `node scripts/check-nursery-covers.js` 核对 47 个唯一图片、歌曲映射、尺寸、预算、生成提示词和网页字节。构建直接使用已提交 JPEG，不依赖生成服务；保留本地原始归档时可用 `python3 scripts/prepare-nursery-covers.py` 重压。

## 本轮工程与界面验收

2026-10-23 本地执行 `npm run build`、`npm test`、`npm run check:release`，均通过；全仓 **455/455** 项测试、101 项发布检查通过。静态主包约 1492.2 KiB，育儿分包 584.6 KiB。官方微信 CLI `preview` 编译成功：主包 1,328,783 字节，育儿分包 597,328 字节，总计 8,239,388 字节。

在微信开发者工具 Stable 2.02.2608080、基础库 3.17.4 中实际进入育儿栏目和原生播放器，验证小白兔白又白、小星星成功播放并推进进度，暂停、睡前 4 首筛选、本机收藏与 15 分钟定时设置反馈正常；检查 390×844 和 320×568 模拟机布局。修正原生 button 默认宽度、320 宽主播放按钮比例及 WXSS 组件不支持的选择器。页面测试另覆盖长列表、搜索、过滤队列、分享不自动播放、拖动进度与切歌竞态。模拟器成功不替代手机端验收。

本次 GitHub、远程封面部署、微信上传与审核发布的实际状态统一记录于 [NURSERY_RELEASE.md](NURSERY_RELEASE.md)，不以本地构建或预览代替上线证明。
