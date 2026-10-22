# ReadyGoDuel 网页上线核查

日期：2026-10-22，Asia/Shanghai。本记录只描述独立网页及现有整站资源，不代表微信小程序上传、审核或正式发布。

## 当前线上状态（等待期间的音效开关修复）

当前 Pages Production 为 [d977c756](https://d977c756.brclio-miniapp-wechat.pages.dev)，完整 ID `d977c756-0b36-4fc5-9963-b21cfa9e4d39`，源码为 [37aa43d6e82207e35c2f2e1d58b1b5295259ad37](https://github.com/Brclio/Brclio-Miniapp/commit/37aa43d6e82207e35c2f2e1d58b1b5295259ad37)，站点版本仍为 `0.1.2`。

补充的实际 React 组件回归复现了一个定时回调缺陷：开局进入 WAITING 后静音，GO 仍播放；静音开局后在 WAITING 中开启声音，GO 仍无声。两个分支分别保留了失败前日志。修复让定时 GO 回调读取最新声音开关引用；原始快照、音效合成函数及参数、游戏画面与报告代码不变，继续由适配脚本确定性生成组件。

- 新增 9 组实际 App.tsx / React DOM 19.2.1 离线组件场景，含 2 个等待中切换声音子分支（Node 共计 11 项）。覆盖设置保存／取消／重置及重挂载、独立彩头密码、隐藏与清空、开局音与抢跑、GO 后超过 5 秒响应、静音、重复按键不重复记局、两轮无限模式及汇总、报告生成接口、TXT 导入和独立 7 天有效期。
- 两个音效失败分支修复后通过；组件加网页专项 16／16，全量 **282／282** 测试、完整构建、发布检查及差异格式检查通过。
- 对比上一轮 1,621 个冻结构建文件，仅 ReadyGo `index.html` 和 `main.js` 字节变化；指纹脚本由 `main-b5032b192e353388.js` 更新为 `main-3ab4b01721b76c67.js`。CSS 仍为 `main-1cc1ef2387a3f342.css`，其余旧文件字节保持一致。生产 bundle 元图的 1,673 个输入中没有 jsdom 或测试文件，内存重建与发布脚本逐字节相同；jsdom 仅为开发依赖。
- 发布后对主域、备用域名分别校验 29 个核心静态文件和 10 项只读接口／路由，合计 **58 项字节校验、20 项接口检查全部通过**。覆盖 ReadyGo 全模块、门户、摄影入口、悦学入口及索引、校验文件、健康版本、账号未授权边界、停用路径和发音接口。本轮没有重复下载全部摄影和学习图片，不将 58 项记录写成又一次全量资源核验。

以上是 Node + JSDOM 的离线组件回归：运行真实 React 组件与事件处理，但不启动浏览器、不连接正式网页或网络。Web Audio、Image、Canvas 和 FileReader 采用明确替身；报告导出使用 `READYGO_TEST_CANVAS_NOT_A_PNG` 测试标记，不能作为真实 PNG、设备可听音效、布局、下载或二维码识读证明。随机数固定，礼花动画帧不循环；同一进程的 helper 实例须串行运行。

用户重开标签后，新的应用内标签仍读取超时；随后 Chrome 复测也超时，原生 Chrome 读取被 Computer Use 明确禁止并终止。未再访问受限页面或改用其他工具自动控制浏览器。本轮新增的上述离线测试没有消除浏览器限制，正式域名的全新点击交互与真机听感仍待验收。没有重新上传小程序或操作微信审核，也未写账号或云备份数据。

本机证据目录为 `artifacts/ready-go-duel/component-regression-2026-10-22/`：`sound-before-fix.log`、`component-tests.log`、`all-tests.log`、`build.log`、`release-check.log`、`build-comparison.json`、`production-bundle-boundary.json`、`deployment-input.json`、`deploy.log`、两域 `production-*.json`、`pages-deployments.json` 与 `release-status.json`。以下均为此前各阶段记录。

## 10:10 续核查（历史部署 c3cad9af）

整站后续发布 `0.1.2`，当前 Pages Production 已为 [c3cad9af](https://c3cad9af.brclio-miniapp-wechat.pages.dev)，完整 ID `c3cad9af-5371-486e-afc5-b7f95563d590`，Source 为 `7d30954e4a0a34099b2cdce47e2bd9328b2e7c38`。本次只读确认了最新部署列表，两域健康接口均为 `0.1.2`，没有为补做交互而重复部署。

对比两次冻结清单，ReadyGo 的 15 个文件全部保持原字节；整站只有 Worker、门户首页及目录版本发生变化。对两个正式域名重新 GET 全部 15 个 ReadyGo 文件及各自健康接口，**32/32** 项通过，实际内容与 `0.1.2` 冻结产物一致。JS／CSS 仍为 `main-b5032b192e353388.js`、`main-1cc1ef2387a3f342.css`，原作布局、音效和报告代码没有变化。

本轮仍能读取浏览器标签信息，但画面、控件及调试画面命令持续超时；新的线上交互复测尚未完成，已请求关闭两个旧标签后重新打开正式网页来重建连接。该阻塞不影响上述普通 HTTPS 核验，不据此宣称交互已验收。续核查证据为本机 `artifacts/ready-go-duel/continuation-2026-10-22/manifest-comparison.json` 与 `production-current.json`。整站 `0.1.2` 的构建、上传及部署证据另见 [悦学验收记录](LINGOTILES_VERIFICATION.md)。

以下 `e0d2ffbd` 与 3,234 项全资源检查属于先前 `0.1.1` 网页上线阶段，继续保留历史原始证据，不将其部署 ID 当作当前版本。

## 0.1.1 网页首次上线来源（历史）

- 正式地址：[主域](https://pocket.bornforthis.cn/projects/ready-go-duel/)、[备用域名](https://pocket.brclio.com/projects/ready-go-duel/)。
- Pages Production 部署：[e0d2ffbd](https://e0d2ffbd.brclio-miniapp-wechat.pages.dev)，完整 ID `e0d2ffbd-a0a0-4c21-a759-19432394e9c2`。
- 部署源码：[525edee1942ccc2ccb1cdc81dfc58e56e0d80a85](https://github.com/Brclio/Brclio-Miniapp/commit/525edee1942ccc2ccb1cdc81dfc58e56e0d80a85)。由已提交的摄影、ReadyGoDuel 和悦学版本 `95d349a` 增加本次资源指纹修复；从干净的隔离 worktree 发布，没有包含主工作区其他正在进行的修改。
- Cloudflare 部署列表已确认 Environment 为 Production、Branch 为 main、Source 为 `525edee`。本地冻结清单记录 1,621 个构建文件，共 105,770,668 字节；此清单是构建内容指纹，不冒充源 Git 提交或微信包指纹。

## 核查与缓存修复

- `npm ci --ignore-scripts`、`npm run build`、全量 **247/247** 测试、`npm run check:release` 以及 `git diff --check` 通过。ReadyGo 原始快照、获准去声控变换、原音效参数、运行依赖隔离、密码彩头、无限模式、报告、计分扩展及 Worker 路由继续受测试约束。
- 原布局继续使用 `100dvh` 和原三条 Tailwind 指令；游戏、图标和战报代码字节未改。React／DOM `19.2.1`、lucide-react `0.556.0`、Tailwind `3.4.17` 与固定上游一致；声控仍按用户授权移除。
- 实测备用域名 HTML 为 `public, no-cache, no-transform`，但 JS／CSS 为 `public, max-age=14400, no-transform`。源码无按域名区分的缓存逻辑，不能仅凭响应头确定外层具体规则名称。未修改 Cloudflare 安全或缓存设置。
- ReadyGo 新页面改用 `main-b5032b192e353388.js`、`main-1cc1ef2387a3f342.css`；名称来自最终文件 SHA-256 前 16 位，旧 `main.js/css` 保留兼容。内容变化会得到新 URL，避免新页面复用同名旧缓存。此修复仅针对 ReadyGo，不能描述为全站缓存策略已改变。
- 对比修复前的 1,619 个构建文件，只有 ReadyGo 首页的资源引用变化；新增两个指纹副本。其他原文件，包括摄影、悦学、二维码、计分扩展和 Worker，均逐字节一致。首页模板、原游戏源码及原 CSS 保持原样。

## 正式域名验证

- 两个正式域名各 **1,617/1,617** 个公开文件实际 GET 的长度和 SHA-256 与冻结构建一致，共 **3,234** 次文件核验；包含全部摄影、悦学词库与已有插图、ReadyGo 默认与计分扩展、门户及业务域名校验文件。
- 两域首页实际引用指纹 JS／CSS，资源均正常返回；校验文件 `jBK3p5zOBn.txt` 返回 200，SHA-256 保持 `b43069dff9b50df306cc836e7261f96a60cac3a4ac51622f1680514f93999090`，没有删除。
- 两域各 **10/10** 项只读接口／路由探测通过：健康接口 200／版本 0.1.1、native 匿名 session 200、未登录备份 401、缺少 native 客户端标头 403、旧记录接口 503、未知接口与停用／替代图片路径 404，以及主动发音返回有效音频。额外确认匿名 session 的 user 为 null，不返回登录 token；未输出 CSRF 值或任何用户资料。
- 备用域名首次检查中一张已有悦学插图请求超时；保留首次失败记录后，只续查该文件和未完成项目，最终全部通过，未重复请求已核验文件。最后报告的 `previousFailures` 保留这次暂时性网络错误，不隐去首轮结果。
- 本轮未写账号或云备份数据，未改变微信或 Cloudflare 安全配置。

## 交互与设备证据边界

此前已在同一字节版本的游戏 JS／CSS 上，实际走通桌面触摸入口、彩头输入、等待／GO、A 键获胜、礼花、揭晓、600×800 原版单局报告、无限模式 L 键抢跑、1:0 汇总和 600×1000 总报告，以及设置试听和计分扩展导航。390×844、320×568 的全屏高度、无页面溢出及设置操作区也已实测，见 [来源说明](../web/projects/ready-go-duel/SOURCE.md)。本次游戏 JS／CSS 与这些已验收字节一致，指纹修复只改变发布引用。

本轮浏览器自动控制多次连接超时，未获得新的正式域名交互截图；随后尝试读取 Codex 原生窗口时，工具明确拒绝该应用访问，未再尝试其他途径访问该应用。因此本轮新增证据是生产 HTTPS 资源、接口、来源与构建一致性检查，不将其冒充新的浏览器交互实测。实体手机声音听感仍需设备验收；自动音效参数测试不能证明扬声器发声。

本次未重新上传小程序、提交微信审核或正式发布小程序。已有账号手动备份与用户数据未写入；线上账号检查只使用无凭据 GET 验证匿名与未授权边界。

## 本机审计证据

`artifacts/ready-go-duel/release-2026-10-22/` 为不随站点发布的本机证据目录：

- `deployment-input.json`、`before-fingerprint-input.json`：最终与修复前文件清单、字节数及 SHA-256。
- `build.log`、`tests.log`、`release-check.log`：冻结版本完整构建与回归。
- `production-main.json`、`production-alias.json`：两域逐文件实际 GET 结果与只读接口探测。
- `verify-production.mjs`：本轮核验脚本，不包含登录凭据或用户数据。
