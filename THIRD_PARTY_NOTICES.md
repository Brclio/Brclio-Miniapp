# 来源与使用范围

## FirstSight_Online 实际摄影

- 来源：[AndersonHJB/FirstSight_Online](https://github.com/AndersonHJB/FirstSight_Online)
- 固定提交：`988cc8d0208ac2cae87b0e36b072007a856356ab`
- 摄影范围：婚纱8组128张、孕期41张，共9组169张；不重复导入聚合相册中的同批婚纱照片。
- 按用户提供的源码与照片范围适配。保留来源标题、说明、日期、标签；不将文字日期当作经EXIF验证的拍摄时间。
- 网页素材是原项目提供的优化WebP，按固定blob原字节保留；小程序素材是其本地JPEG展示衍生文件。原始大JPG不修改、不内置，不提供外部原图查看。
- 来源、原始与优化路径、Git blob SHA和SHA-256见 `web/projects/firstsight/original-data.json`；原生衍生清单见 `miniprogram/data/photo-assets.json`。
- 排除旧FirstSight的Unsplash样例、模拟EXIF、儿童示例身份、浮生文字重排、信件、随笔、评论、视频与node_modules。

摄影界面此前参考 AndersonHJB/FirstSight 的系列与灯箱结构。本次保留交互思路并重设计；图片来源已按用户更正改为 FirstSight_Online。旧AI婚纱灵感模块仅归档保留，当前不构建、不公开。来源记录不为上游代码授予新的许可证。

## Brclio Design System

- 来源：[Brclio/brclio-design-system](https://github.com/Brclio/brclio-design-system)
- 作者：Brclio（黄家宝）
- 许可证：CC BY-NC-SA 4.0（署名、非商业性使用、相同方式共享）。
- 使用内容：App 型模板、品牌配色、字体建议、作者资料与头像。当前内容空间、摄影模块、原生对局与战报、悦学入口和手机学习页按相同设计语言适配。
- 如需超出上述许可范围的商业使用，应确认权利人授权。此说明不为设计素材添加新的授权。

## ReadyGoDuel 互动适配

- 原作：[AndersonHJB/ReadyGoDuel](https://github.com/AndersonHJB/ReadyGoDuel)
- 作者：AI悦创／AndersonHJB
- 本次参考版本：`e3efd5f3c1f40ac780cce0ff170b904922b1acf5`
- 默认网页以该固定提交的 React 源码与界面为基线；原生小程序适配触摸、无限模式、开始／GO／抢跑／胜利音效、彩头、设置与战报。用户本次明确允许移除声控，因此两端不再提供麦克风采集、录音及录音高光回放；不再声称当前完整源码与固定原作逐字一致。功能对照和仍待设备验收的项目见 [READY_GO_DUEL_PARITY.md](docs/READY_GO_DUEL_PARITY.md)，不以源码接入代替视觉、听觉或真机验收。
- 本仓库原有的 1／3／5 分 Canvas 挑战保留为独立计分扩展，不改变默认原作玩法。该扩展的本机记录与可选账号备份遵循各自数据说明；已移除的声控与录音不进入备份范围。
- 模块登记为「放松 → 双人反应挑战」，固定路径 `/projects/ready-go-duel/`，并提供原生固定入口；本次恢复的部署和微信发布状态需另行验收，见 [验证记录](docs/VERIFICATION.md)。不设置审核身份、时间或隐藏入口分流。
- 原仓库 README 要求使用前获得作者授权，二次开发开源并告知作者链接。分发相关源码与互动模块时仍应遵守该要求，不将原作视为 MIT 或其他未授予的许可证。
- 本项目源码仓库地址为 [Brclio/Brclio-Miniapp](https://github.com/Brclio/Brclio-Miniapp)。本工程不会自动向原作者发送消息，仓库发布与原作者告知是分别处理的事项。

网页宿主和本机数据范围见 [模块来源说明](web/projects/ready-go-duel/SOURCE.md)。原作网页保留 `counter.bornforthis.cn` 的 PV 计数脚本及网站二维码的本地副本；原生小程序战报按用户要求重新设计，并使用用户提供的 Brclio 悦创小程序码，原文件字节保存在 `miniprogram/assets/duel-miniprogram-code.jpg`。本次移除声控、麦克风采集、录音与录音回放。原生战报仅在点击保存时请求相册写入权限。计分扩展的账号备份范围见账号说明。

## LingoTiles「词了个词」学习适配

- 来源：[Brclio/brclio-lingotiles](https://github.com/Brclio/brclio-lingotiles)，作者／来源方：Brclio。
- 固定提交：`a6a3841b846d72932301d43ddb9c30e756a22c7b`。固定来源的 `upstream/` 与 `public/` 文件按 [SNAPSHOT.json](web/projects/lingotiles/SNAPSHOT.json) 保留原路径、字节数和 Git blob SHA-1，共 1,454 个文件。手机界面和平台 I/O 适配与原始来源分开维护。
- 按用户提供的自有项目范围接入经典六关、54 个精选词、10 万词分级、配对规则、单词本、学习进度、通关足迹和原有词义插图。54 个经典词包含在 10 万词总数中；现有插图索引为 1,083 个已配图义项、98,917 个待配图义项，本轮不以文字占位冒充已完成图片。
- 来源快照中的设计文档与图片按原项目来源保留；本说明不为上游源码或图片添加未经授予的许可证，也不将整个 LingoTiles 项目声明为 MIT。工程手机呈现继续注明 Brclio Design System 的署名与许可。
- 功能、数据与验收范围见 [LINGOTILES_PARITY.md](docs/LINGOTILES_PARITY.md)。当前源码接入不等同于部署或微信正式发布。

### ECDICT 词典数据

- 来源：[skywind3000/ECDICT](https://github.com/skywind3000/ECDICT)，固定修订 `bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b`。
- 来源 CSV SHA-256：`1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf`；固定词库来源信息保存在 [vocabulary/manifest.json](web/projects/lingotiles/public/vocabulary/manifest.json)。
- 许可证：MIT；固定修订的版权声明为 **Copyright (c) 2025 Linwei**。许可正文见该修订的 [LICENSE](https://github.com/skywind3000/ECDICT/blob/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b/LICENSE)，分发相关数据副本或实质性部分时应保留其版权与许可声明。
- 小学到大学的分类是本项目来源按标签、词频等形成的学习路线，不代表词典作者或官方考试机构背书，也不是官方考试大纲。

### 设备与词典发音

网页朗读使用浏览器提供的语音能力；小程序主动发音经本站固定接口转发有道词典 `dict.youdao.com/dictvoice`。该服务提供发音，不为本工程源码或词库添加许可；请求范围和本机学习数据边界见功能对照。本工程不在学习过程中调用图片生成服务。

## 运行依赖

- React 与 React DOM：根依赖 `18.3.1`，ReadyGoDuel 独立网页按原作固定 `19.2.1`；MIT License，Copyright (c) Facebook, Inc. and its affiliates。后者使用的 scheduler `0.27.0` 同为 MIT。
- lucide-react：根依赖 `0.460.0`，ReadyGoDuel 独立网页按原作固定 `0.556.0`；ISC License；部分图标源自 Cole Bemis 的 Feather（MIT），其余版权归 Lucide Contributors。
- 构建保留依赖许可证注释；分发时应保留各依赖的版权和许可声明。

esbuild 与 Wrangler 是构建、部署开发依赖。ReadyGoDuel 独立网页保留原项目的访问统计脚本；原生小程序没有接入该脚本。已恢复的可用摄影图片随同一 Cloudflare 项目分发，页面不依赖上游图片站点实时加载；第三方图片的原始地址仅作为来源记录保留。
