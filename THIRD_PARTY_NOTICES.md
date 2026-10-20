# 来源与使用说明

## 当前摄影图片

FirstSight 适配版与婚纱灵感图册使用的花园、海岸主题图片由 AI 生成，作为本项目的视觉示意使用。页面明确标注「AI 生成」「非真实客片」，不将其作为真实人物拍摄、客户案例或门店服务成果。图片中的人物、服装和场景仅供风格参考。

## FirstSight 摄影适配

- 上游：[AndersonHJB/FirstSight](https://github.com/AndersonHJB/FirstSight)
- 固定来源提交：`6fafcfd4371b00d8c956e58cb5bf689911b5fb2c`
- 适配位置：`web/projects/firstsight/`。保留摄影系列封面、影集详情及沉浸式大图浏览结构，改用本域素材与项目 CSS。
- 未导入上游家庭、儿童、个人信件、留言、文章、视频或外部图库，不包含虚构 EXIF。
- 上游文件与当前适配范围见 [SOURCE.md](web/projects/firstsight/SOURCE.md)。来源记录不为上游代码授予新的许可证。

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
- `0.1.1` 待发布范围已将该模块公开登记为「放松 → 双人反应挑战」，路径 `/projects/ready-go-duel/`，并提供原生固定入口；完整版本的最终部署和微信发布状态见 [验证记录](docs/VERIFICATION.md)。不设置审核身份、时间或隐藏入口分流。
- 原仓库 README 要求使用前获得作者授权，二次开发开源并告知作者链接。分发相关源码与互动模块时仍应遵守该要求，不将原作视为 MIT 或其他未授予的许可证。
- 本项目源码仓库地址为 [Brclio/Brclio-Miniapp](https://github.com/Brclio/Brclio-Miniapp)。本工程不会自动向原作者发送消息，仓库发布与原作者告知是分别处理的事项。

本次网页宿主和本机数据范围见 [模块来源说明](web/projects/ready-go-duel/SOURCE.md)。当前没有云端记录上传或备份。

## 运行依赖

- React 与 React DOM `18.3.1`：MIT License，Copyright (c) Facebook, Inc. and its affiliates。
- lucide-react `0.460.0`：ISC License；部分图标源自 Cole Bemis 的 Feather（MIT），其余版权归 Lucide Contributors。
- 构建保留依赖许可证注释；分发时应保留各依赖的版权和许可声明。

esbuild 与 Wrangler 是构建、部署开发依赖。本项目不包含原项目的访问统计脚本，也不依赖第三方图片或动态脚本 CDN 加载当前摄影内容。
