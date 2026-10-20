# Brclio 口袋

微信普通小程序与网页内容空间，按「摄影」「放松」两个栏目组织独立项目。`0.1.1` 包含三个公开入口：摄影中的 FirstSight 与婚纱灵感图册，以及放松中的「双人反应挑战」。

**`0.1.1` 三个网页模块已部署，微信开发版本已上传成功；93 项测试及发布检查通过。** 两个域名的已测资源与本地产物字节一致，旧独立 Worker 入口已停用。尚无微信审核提交、审核通过或正式发布证据；新增反应挑战对应的类目和产品形态仍需在后台核对。见 [验证记录](docs/VERIFICATION.md)。

- 微信入口：[pocket.bornforthis.cn](https://pocket.bornforthis.cn)，沿用已备案域名。
- 公开网页：[pocket.brclio.com](https://pocket.brclio.com)
- 源码仓库：[Brclio/Brclio-Miniapp](https://github.com/Brclio/Brclio-Miniapp)
- 服务提供者：莆田市荔城区黄家蓉宝电脑店
- 联系邮箱：aiyuechuang@gmail.com

## 当前版本内容

- 首页从 `projects.json` 加载栏目与卡片：摄影两个项目，放松一个项目。
- FirstSight 保留「系列封面 → 影集详情 → 大图浏览」结构，只适配摄影部分，不导入上游家庭、儿童、个人信件或留言内容。
- 两个摄影模块使用项目已有的花园与海岸 AI 图片，明确标注 AI 生成、非真实客片。
- 双人反应挑战公开登记在 `/projects/ready-go-duel/`：两人在同一设备等待 GO 信号，支持先得 1／3／5 分、抢跑、平局和本机战绩。
- 反应挑战在浏览器本地保存使用偏好与最近 20 场完整记录，可在模块内清除；记录不上传 Cloudflare 或 GitHub，不提供云备份。
- 无注册、登录、上传、评论、预约或交易，不创建云端用户档案，也不上传浏览记录。

网页与图片由 Cloudflare 分发，微信可能产生正常加载缓存；服务方可能处理完成网络请求所需的信息。客户端不持有服务凭据，不接入广告或访问行为分析。清理缓存或网页存储可能清除本机记录与偏好。

## 本地运行

需要 Node.js 20 或更新版本。

```sh
npm ci
npm run build
npm run dev:web
```

构建将首页与状态为 `active` 的模块统一输出到 `dist/web`。检查两个栏目、三个模块、返回路径与本机记录清除。

```sh
npm test
npm run check:release
npm run wechat:open
```

开发者工具导入项目根目录，代码目录为 `miniprogram/`，AppID `wx59aa532fbf6fa540`。原生 `web-view` 只接受登记 ID，映射到配置域名的固定路径；放松入口打开 `/?category=relax`，不接受任意网址。

## 一个 Cloudflare 项目

`0.1.1` 统一使用 Pages 项目 `brclio-miniapp-wechat`：首页在 `/`，各模块在 `/projects/<id>/`。后续增加模块仍使用同一构建与部署，无需新增 Cloudflare 项目或微信业务域名。

```sh
npm run deploy
```

`npm run deploy:wechat-web` 是同一命令的别名。Pages 服务在访问静态资源前核对构建生成的开放项目清单；未开放项目不构建，直接访问其模块路径返回 404。旧云端记录接口保持不可用。历史独立 Worker 已解除公开域名绑定，`workers.dev` 和预览入口均已停用；源码归档保留，当前发布命令不部署它。

微信仅使用已备案的 `pocket.bornforthis.cn` 业务域名；`pocket.brclio.com` 作为公开网页入口。添加模块使用路径即可，仍需遵守平台实际类目、资质、隐私和审核要求，模块化部署不等于免审核。

接入和停用模块见 [PROJECTS.md](docs/PROJECTS.md)，发布步骤见 [RELEASE.md](docs/RELEASE.md)。

## 项目结构

```text
miniprogram/             微信原生目录、固定入口、关于和隐私
projects.config.json    构建登记：react／static／canvas 与素材复制
web/portal/             内容首页与公开 projects.json 清单
web/projects/firstsight/ FirstSight 摄影适配
web/wedding/            婚纱灵感图册与两张 AI 图片
web/projects/ready-go-duel/ 双人反应挑战网页宿主
minigame/lib/           反应挑战共享规则、Canvas 界面与本机存储
web/pages-worker.mjs    健康检查、停用记录 API 和开放项目路径控制
web/public/             微信业务域名校验文件
cloudflare/             历史部署配置
scripts/                统一构建、开发者工具和发布检查
docs/                   项目接入、发布步骤与验证记录
```

来源与使用要求见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
