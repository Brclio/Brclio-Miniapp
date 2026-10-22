> 当前 `0.1.3` 的永久登录、自动同步、GitHub 提交、Pages 部署与微信开发版上传以 [ACCOUNT_SYNC_RELEASE.md](ACCOUNT_SYNC_RELEASE.md) 为准；下文保留此前阶段的实际记录，不作为本版发布状态。

# 添加与更新内容项目

内容空间采用一个 Cloudflare Pages 项目 `brclio-miniapp-wechat`。首页、公开清单和所有模块统一构建到 `dist/web`，模块地址固定为 `/projects/<id>/`。以后每月增加内容或模块，都继续部署这个项目。

当前 `0.1.0` 公开网页只开放 `firstsight`、`ready-go-duel` 两个模块；旧 `wedding` AI 示例已停用。原生摄影、相册与游戏均内置代码。独立网页「我的」仍属于门户访客界面，不是额外构建模块；原生小程序「我的」已接入本项目独立账号页，同一 Pages 项目的 `/api/account/*` 后端已部署并通过真实邮箱联调。用户后台截图已核对服务器域名及 AppID，19:21 原生微信一键登录已成功，退出后再次微信登录已实测复用同一用户，微信账号邮箱绑定仍待实际提交验收；本轮账号小程序包尚未上传、真机验收、审核或发布；配置与验收见 [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md) 和 [ACCOUNT_VERIFICATION.md](ACCOUNT_VERIFICATION.md)。当前发布状态见 [VERIFICATION.md](VERIFICATION.md)，此前 `0.1.1` 为历史记录。新增互动的实际类目和产品形态要求仍需核对。

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

## FirstSight_Online 摄影与原生分包

当前只开放 FirstSight_Online 的实际摄影：8组婚纱128张、孕期41张。来源固定提交 `988cc8d0208ac2cae87b0e36b072007a856356ab`，逐文件路径、Git blob和SHA-256见 `original-data.json`。网页使用上游169个优化WebP（20,325,346字节），小程序使用由它们生成的本地JPEG，不改动约4GB的原始JPG；没有原图网站依赖。

```sh
npm run sync:firstsight
npm run prepare:photos
npm run build
```

第一步显式联网，通过现有gh认证读取固定blob；普通构建离线。第二步在macOS使用sips生成本地展示图和主包封面，按完整相册分配分包，避免跨分包资源引用。唯一相册页面模板是 `native/album/`；`miniprogram/photo-*` 是生成文件，修改模板后构建即可同步全部页面。原生目录只使用本地封面，数据中的 `nativePath` 决定相册所属分包。

旧 `wedding` AI示例模块设为planned，不构建、不公开。真实摄影不混入旧FirstSight样例、重复聚合、模拟EXIF、信件、视频或留言。来源和导入维护见 [SOURCE.md](../web/projects/firstsight/SOURCE.md)。

## ReadyGoDuel 原作与计分扩展

默认 `/projects/ready-go-duel/` 恢复原作固定提交 `e3efd5f3c1f40ac780cce0ff170b904922b1acf5` 的 React 界面与玩法，包含触摸、无限模式、开始／GO／抢跑／胜利音效、彩头设置与 TXT 导入、自定义标题和玩家名、3–10 秒最大等待时间及 PNG 战报。用户本次明确允许移除声控，因此麦克风、录音和录音回放不再属于交付范围；其他原有功能继续保留。源码、构建登记和逐项验证证据见 [READY_GO_DUEL_PARITY.md](READY_GO_DUEL_PARITY.md)；未经真机与听觉验收，不将这些接入记录表述为最终效果已完全一致。

原生 `/pages/duel/index` 按用户最新要求采用 Brclio 品牌的手机布局：原生导航、上下对坐触控区、底部操作栏与可滚动底部面板。单局和无限总战报同步重设计，分别输出 600×900、600×1100 PNG，使用用户提供的真实小程序码；原始码文件按字节保留在 `miniprogram/assets/duel-miniprogram-code.jpg`。

原有 Canvas 实现保留为可选计分扩展，提供 1／3／5 分赛制、35 ms 平局窗口、5 秒无人响应超时、本机最近 20 场记录和暂停；这些规则不替代默认原作单轮玩法。共享引擎、平台适配与本机记录继续维护于 `minigame/lib/` 和 `web/runtime.js`，独立扩展页面由网页构建脚本生成，固定地址为 `/projects/ready-go-duel/match/`。`canvas` 类型仍只用于该共享实现；新增其他实现时应明确修改并验证构建流程。

公开卡片将项目登记到 `relax`，固定路径保持不变。原作网页保留 `counter.bornforthis.cn` 的 PV 计数脚本；战报二维码使用原图片的本地副本。网页与小程序均不申请麦克风，也不采集或保留录音。恢复原源码时应同步维护网络策略、权限策略与隐私说明，不能再宣称整个模块完全没有外部脚本或网络请求。来源见模块 `SOURCE.md`。

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

当前摄影只读；原生与网页 ReadyGoDuel 分别在本机保存设置和自定义彩头，不采集录音。计分扩展保留最近 20 场本机记录，可在模块内清除；当前不接入共享账号或云端备份，本机数据与旧记录保留边界见 [ACCOUNT_PLAN.md](ACCOUNT_PLAN.md)。原作网页的 PV 请求与原生权限范围见功能对照。素材与网页随项目构建发布。来源署名、版权说明和 AI 标注随模块一起维护；新增外部项目时只适配授权范围内需要的部分，并记录固定上游提交与裁剪范围。
