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
- 使用内容：App 型模板、品牌配色、字体建议、作者资料与头像。当前内容空间、摄影模块与原生入口按相同设计语言适配。
- 如需超出上述许可范围的商业使用，应确认权利人授权。此说明不为设计素材添加新的授权。

## ReadyGoDuel 互动适配

- 原作：[AndersonHJB/ReadyGoDuel](https://github.com/AndersonHJB/ReadyGoDuel)
- 作者：AI悦创／AndersonHJB
- 本次参考版本：`e3efd5f3c1f40ac780cce0ff170b904922b1acf5`
- 本项目重新实现双人同屏触屏反应，复用仓库的规则、Canvas 界面和本机存储源码；不是原 React 网页的完整镜像。
- `0.1.1` 已将该模块公开登记为「放松 → 双人反应挑战」，路径 `/projects/ready-go-duel/`，并提供原生固定入口；完整版本的最终部署和微信发布状态见 [验证记录](docs/VERIFICATION.md)。不设置审核身份、时间或隐藏入口分流。
- 原仓库 README 要求使用前获得作者授权，二次开发开源并告知作者链接。分发相关源码与互动模块时仍应遵守该要求，不将原作视为 MIT 或其他未授予的许可证。
- 本项目源码仓库地址为 [Brclio/Brclio-Miniapp](https://github.com/Brclio/Brclio-Miniapp)。本工程不会自动向原作者发送消息，仓库发布与原作者告知是分别处理的事项。

本次网页宿主和本机数据范围见 [模块来源说明](web/projects/ready-go-duel/SOURCE.md)。当前没有云端记录上传或备份。

## 运行依赖

- React 与 React DOM `18.3.1`：MIT License，Copyright (c) Facebook, Inc. and its affiliates。
- lucide-react `0.460.0`：ISC License；部分图标源自 Cole Bemis 的 Feather（MIT），其余版权归 Lucide Contributors。
- 构建保留依赖许可证注释；分发时应保留各依赖的版权和许可声明。

esbuild 与 Wrangler 是构建、部署开发依赖。本项目不包含原项目的访问统计脚本。已恢复的可用摄影图片随同一 Cloudflare 项目分发，页面不依赖上游图片站点实时加载；第三方图片的原始地址仅作为来源记录保留。
