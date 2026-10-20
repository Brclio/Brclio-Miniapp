# 已被替代的历史验证记录

以下记录属于此前 0.1.1 和用户更正前的 FirstSight 来源，不代表当前实现、当前上传或当前发布状态。当前使用 FirstSight_Online，详见 ../VERIFICATION.md。

# 验证记录

日期：2026-10-20（Asia/Shanghai）。版本：`0.1.1` Brclio 内容空间，含摄影与放松。

## 当前原图恢复修正

FirstSight 已恢复原项目的 14 组摄影内容、97 条原始照片记录、101 个展开图片条目。34 个下载成功的原始图片文件共 18,197,609 字节，对应 80 个可用条目；9 个上游 404 地址和 1 个没有文件的本地路径示例对应 21 个失效条目，保留状态，不以 AI 图片替换。来源快照、哈希及逐图片状态见 [FirstSight 来源清单](../web/projects/firstsight/SOURCE.md)。

- `npm test`：96／96 项通过；`npm run check:release` 通过，原生包约 166.3 KiB。
- 离线重新导入生成的 `original-data.json` 字节一致；正常构建不联网获取图片。
- 微信开发者工具已成功重新上传 `0.1.1`，使用原图封面，上传说明包含 14 组影集。界面为 0 Errors／5 Warnings，代码质量良好。本机证据为 `artifacts/wechat-upload-0.1.1-original-photos.png`，不提交截图目录到源码仓库。
- 原图版本已部署为 [bf140573](https://bf140573.brclio-miniapp-wechat.pages.dev)。`pocket.bornforthis.cn` 与 `pocket.brclio.com` 各 40 个资源均返回成功，SHA-256 与本地产物一致：全部 34 个原图文件、根首页、`projects.json`、FirstSight HTML／JS／CSS 及业务域名校验文件。两域名健康接口均返回 `0.1.1`、`syncAvailable: false`，未知项目及 FirstSight 旧替代图路径返回 404，旧记录接口返回 503。最终部署仅增加旧替代图路径的缓存拦截，静态资源保持同一哈希，并复核页面、清单、脚本、原图封面与校验文件。
- 本地概览显示 14 组、101 个图片条目；画廊 8 个条目中 2 个失效、家庭 17 个中 5 个失效、云南旅行 8 个中 3 个失效，提示与清单一致。大图可在原图、失效条目和下一张原图之间前后切换，键盘切换、Escape 关闭及返回影集通过，未发现相关控制台错误。390 × 844 移动视口页面宽度为 390，无横向溢出；原图大图正确加载，显示尺寸 390 × 260，说明和按钮完整，控制台无错误或警告。截图为 `artifacts/firstsight-original-photos-mobile.png` 与 `artifacts/firstsight-original-photos-desktop.png`。

## 部署架构与既有验收

- 同一 Pages 项目 `brclio-miniapp-wechat` 包含 `firstsight`、`wedding`、`ready-go-duel`；摄影两个，放松一个。
- `pocket.bornforthis.cn`、`pocket.brclio.com` 的 Cloudflare 域名此前已核验 active，用户已确认 DNS 修改，微信业务域名此前已确认保存。
- 历史独立 Worker 的公开域名绑定已移除，域名列表为空；`workers.dev` 与预览入口已停用，当前发布命令只部署 Pages 项目。
- 未修改的反应挑战此前完成本地先得 1 分抢跑流程：红方抢跑、蓝方获胜，记录核对后通过界面清除；返回放松栏目正常，390 px 移动和 2240 px 桌面视口无横向溢出，控制台无错误。

本地浏览器结果不作为微信客户端真机或线上完整交互通过的证据。

## 实际功能与数据范围

- 两个栏目及三个模块均为公开入口，不按审核身份或时间隐藏、替换功能。
- 原生固定 ID 为 `content-hub`、`firstsight`、`wedding-inspiration`、`relax`、`ready-go-duel`，只映射到配置域名的固定路径。
- 构建只输出 `active` 模块，Pages 服务在读取静态资源前按编译清单拒绝其他模块路径，不以隐藏卡片代替停用。
- FirstSight 适配来源为上游提交 `6fafcfd4371b00d8c956e58cb5bf689911b5fb2c`。当前修正恢复 `gallery`、`wedding`、`family`、`baby`、`travel` 的原有图片地址、分组与照片元数据；可用图片以原始下载字节随同一 Cloudflare 项目分发，失效图片保留提示，不使用此前两张 AI 图片替换。独立婚纱灵感图册仍使用两张已标注的 AI 图片。没有导入视频、信件、随笔、留言、评论或模拟 EXIF。
- 反应挑战支持同屏双人 GO、1／3／5 分、抢跑和平局；浏览器本地保存偏好及最近 20 场记录，可由用户清除，不上传 Cloudflare 或 GitHub，不提供云备份。

## 尚未取得的微信发布证据

- 最新开发包的体验版设置与 iOS／Android 微信客户端真机验收。
- 已知后台类目为「生活服务 → 婚庆服务」，尚未确认覆盖本次新增双人反应互动。提交前需按真实玩法核对对应类目、资质与产品形态要求。
- 微信后台最终提交审核、审核通过及正式发布。

当前原图修正已完成测试、网页部署、本地交互验收和微信开发包重新上传，两个域名的原图、页面、健康接口与停用路径均已核验。开发包上传不能表述为小程序审核已提交或已上线。具体步骤与可复制的如实审核说明见 [RELEASE.md](RELEASE.md)。
