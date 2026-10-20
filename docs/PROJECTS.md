# 添加与更新内容项目

内容空间采用一个 Cloudflare Pages 项目 `brclio-miniapp-wechat`。首页、公开清单和所有模块统一构建到 `dist/web`，模块地址固定为 `/projects/<id>/`。以后每月增加内容或模块，都继续部署这个项目。

当前 `0.1.1` 包含三个模块：`firstsight`、`wedding`、`ready-go-duel`；摄影两个，放松一个。FirstSight 原图恢复已通过 96 项测试和发布检查，修正后的微信开发包已重新上传；网页已部署为 [bf140573](https://bf140573.brclio-miniapp-wechat.pages.dev) 并通过本地交互验收，两个域名各 40 个资源的 SHA-256 与本地产物一致；审核与正式发布仍未取得证据。新增互动的后台类目和产品形态要求仍需核对，后续更新不能仅沿用摄影阶段的类目结论。

## 两份清单各管什么

| 文件 | 用途 |
| --- | --- |
| `projects.config.json` | 构建登记：模块 ID、源码目录、React／静态／Canvas 类型、入口和素材复制 |
| `web/portal/projects.json` | 用户可见内容：栏目、项目名称、说明、封面、状态和固定链接 |
| `miniprogram/data/catalog.js` | 微信原生快捷入口，只在需要新增原生入口时修改 |

首页在加载时请求 `/projects.json`，不写死每个项目的页面布局。仅有展示清单不会生成新模块；开放项目必须同时有构建登记，且 ID 与路径完全匹配。

## 添加静态模块

1. 选择稳定 ID，例如 `photo-notes`。构建 ID 必须以小写字母开头，只含小写字母、数字、连字符，最长 48 字符；不要修改已发布项目的 ID。
2. 把独立页面放入 `web/projects/photo-notes/`，例如 `index.html`、`main.js`、`style.css` 与 `assets/`。页面内用相对路径加载自己的代码和素材，返回内容空间使用 `/`。
3. 在 `projects.config.json` 的 `projects` 数组添加：

```json
{
  "id": "photo-notes",
  "kind": "static",
  "source": "web/projects/photo-notes",
  "files": ["index.html", "main.js", "style.css"],
  "assets": [
    { "source": "web/projects/photo-notes/assets", "target": "assets" }
  ]
}
```

4. 在 `web/portal/projects.json` 的 `projects` 数组添加完整卡片：

```json
{
  "id": "photo-notes",
  "category": "photography",
  "status": "active",
  "kind": "gallery",
  "title": "光影笔记",
  "subtitle": "观察一束光的变化。",
  "description": "浏览摄影构图与光线参考。",
  "path": "/projects/photo-notes/",
  "cover": "/projects/photo-notes/assets/cover.jpg",
  "coverAlt": "准确描述封面实际内容",
  "disclosure": "按素材实际来源填写说明",
  "label": "摄影参考",
  "action": "打开光影笔记"
}
```

示例文案需按实际内容替换；封面文件必须存在，AI 图片要在卡片、正文与大图中清楚标注。不要放入本机绝对路径、外部任意 URL、凭据、上游私人资料或未准备发布的内容。

## 添加 React 模块

源码同样放在 `web/` 内，登记示例：

```json
{
  "id": "photo-notes",
  "kind": "react",
  "source": "web/projects/photo-notes",
  "entry": "main.tsx",
  "html": "index.html",
  "assets": [
    { "source": "web/projects/photo-notes/assets", "target": "assets" }
  ]
}
```

esbuild 将入口及依赖打包为该模块的 `main.js`；入口导入 CSS 时另生成 `main.css`。HTML 应引用对应的 `main.js`／`main.css`，素材使用模块内相对路径或受验证的同域模块路径。所需依赖加入根目录 `package.json` 并更新锁文件，不为模块单独创建 Cloudflare 项目。FirstSight 是现有 React 接入示例，来源范围见其 `SOURCE.md`。

## FirstSight 原图与来源同步

FirstSight 使用 `web/projects/firstsight/original-data.json` 中的摄影分组和图片清单，原始图片保存在模块自己的 `assets/original/`。当前来源固定于提交 `6fafcfd4371b00d8c956e58cb5bf689911b5fb2c`：画廊、婚纱、家庭、成长及旅行共 14 组，97 条照片记录展开为 101 个图片条目，其中 80 个可用条目复用 34 个原始图片文件。21 个不可用条目保留错误状态，不用 AI 素材替代。

正常 `npm run build` 不联网，读取已提交的数据、来源快照和素材。需要更新可用性时显式执行：

```sh
node scripts/sync-firstsight.mjs --download
```

不带 `--download` 可离线重建和核对数据。文件哈希、来源地址、原始字节数、固定随机种子及重取来源快照的方法见 [来源说明](../web/projects/firstsight/SOURCE.md)。维护时保留原标题、描述、分组和多图记录，检查失效图片提示；不要重新将所有 FirstSight 图片标成 AI 示例。独立 `wedding` 模块的两张 AI 图片与 FirstSight 来源分别维护。导入范围不包括视频、信件、随笔、留言和评论。

## 当前 Canvas 模块示例

反应挑战的构建登记如下：

```json
{
  "id": "ready-go-duel",
  "kind": "canvas",
  "source": "web/projects/ready-go-duel",
  "files": ["index.html", "page.css", "local.js"],
  "assets": [
    { "source": "web/projects/ready-go-duel/assets", "target": "assets" }
  ]
}
```

当前 `canvas` 类型专用于仓库已有的反应挑战引擎：除了复制登记文件，还会复制共享 `web/runtime.js`、`web/style.css`，并用 `scripts/bundle-game.js` 生成模块内 `bundle.js`。它不是任意 Canvas 代码的通用适配器；新增其他实现时应明确修改并验证构建流程。

公开卡片将该项目登记到 `relax`，固定路径为 `/projects/ready-go-duel/`，展示类型为 `reaction`。`local.js` 关闭共享界面的云备份能力，产物不带备份脚本或 API 配置；使用偏好和最近 20 场记录仅保存在浏览器本地。来源见该模块的 `SOURCE.md`。

## 栏目与状态

栏目固定为 `photography`（摄影）和 `relax`（放松），不要在清单里随意新增顶层栏目或改名。状态支持 `active`、`planned`，只有 `active` 项目会显示为可打开卡片。未开放栏目必须保持诚实的未开放说明；某个栏目仍为 `planned` 时，不能在其中登记 `active` 项目。

当前摄影为两个项目，放松为双人反应挑战一个项目，两个栏目都为 `active`。未来栏目若无实际可开放内容，应使用真实的未开放状态；不能只用改栏目名字的方法承载不符合实际类目或审核范围的功能。

## 停用模块

将展示清单中的项目状态改为 `planned`（或移除该项目），然后重新构建部署。构建仅输出清单中 `active` 的已登记模块，并把相同开放 ID 编译进 Pages 服务；访问未开放 `/projects/<id>/` 会在读取静态资源前返回 404，避免仅隐藏卡片而旧链接仍可打开。

部署后验证首页卡片已移除、模块路径及素材路径均为 404。停用前检查其他开放项目是否引用该模块的封面或素材，必要时把素材移到仍开放的模块并更新链接。原生快捷入口也应相应更新；若旧原生包仍保留停用路径，服务端应继续拒绝该路径，而不是重新开放内容。

## 每月更新流程

1. 更新模块内容／素材；有新模块时增加构建登记，有新卡片或文案时更新展示清单。
2. 运行 `npm run build`、`npm test`、`npm run check:release`，用 `npm run dev:web` 检查本地首页、卡片、模块和返回路径。
3. 运行 `npm run deploy`，统一发布同一个 Pages 项目。微信仍使用已备案的 `pocket.bornforthis.cn`，不为每个模块增加域名。
4. 检查域名下 `/projects.json`、新模块、素材、旧模块和业务域名校验文件，确认实际内容与发布清单一致。
5. 记录内容版本、验证结果和部署地址；原生页面有变化时同步版本并重新上传微信包。

已有获准范围内的图片、文字和既有模块内容更新，在技术上可以通过同一网页部署完成；是否需要微信审核仍以实际变化和平台要求为准。新增功能、数据采集、登录、交易、对外服务类型或权限变化，需要重新判断类目、资质、隐私填报及版本审核，不能承诺所有未来更新都无需审核。

原生入口仅需指向稳定内容空间，就能浏览后续公开清单。若需要新增原生快捷卡片，必须在 `miniprogram/data/catalog.js` 登记固定 ID 与固定模块路径，更新相关原生页面和测试，再上传微信版本；不要开放任意 URL 参数。

## 素材与数据

当前摄影只读；反应挑战仅在浏览器本地保存偏好和最近 20 场记录，可在模块内清除。没有云端用户档案、浏览记录或对局写入，不使用私有 GitHub 数据仓库存储用户数据。素材与网页随项目构建发布。来源署名、版权说明和 AI 标注随模块一起维护；新增外部项目时只适配授权范围内需要的部分，并记录固定上游提交与裁剪范围。
