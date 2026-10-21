# Ready Go Duel 原版与计分扩展

- 原作：[AndersonHJB/ReadyGoDuel](https://github.com/AndersonHJB/ReadyGoDuel)，作者 AI悦创／AndersonHJB。
- 固定参考提交：`e3efd5f3c1f40ac780cce0ff170b904922b1acf5`。
- `upstream/App.tsx` 保留原作 `src/App.tsx` 的固定源码。2026-10-21 用户明确允许去掉不够准确的声控；`adapt-original.cjs` 从此快照确定性生成实际运行的 `App.tsx`，彻底移除声控、音高分析、麦克风采集、录音和回放代码，并将原试听音放到设置中。另将战报二维码 URL 改为本模块的同源静态副本。
- 其他功能保留原布局、触摸／无限世界、开始／GO／胜利／抢跑音效、音效开关、音频试听、彩头库及分类、独立彩头密码、TXT 导入、设置、键盘 A / L、礼花与 PNG 战报。
- 原始快照去除末尾空白后的 SHA-256：`12a816d6451e45be34d4a9c9cd9b583a2ee088ed40a74b69a08e1d8578777363`。`tests/ready-go-duel-web.test.js` 校验原始快照指纹及当前运行源码严格等于获准变换的结果，另检查运行源码无麦克风／录音／回放能力。
- `assets/ReadyGoDuel.png` 为原作引用的 [原始二维码](https://ai.bornforthis.cn/images/ReadyGoDuel.png) 的逐字节副本（350 × 350）；SHA-256：`8fc05e6375191a56647947fe8507915d7ac5af83f4e2e55f88821cb566fa1e6d`。

默认入口 `/projects/ready-go-duel/` 渲染原版 React 界面。React、图标与 Tailwind 3 样式在本地构建后随站点发布；不依赖浏览器中的样式 CDN。与原作一致的 Tailwind 默认主题扫描原组件。底部另占一行提供返回内容空间和计分扩展入口，不覆盖双方操作区；原版 DIY / PV 挂件位于此导航之上。

`/projects/ready-go-duel/match/` 保留原有 1 / 3 / 5 分赛制、同时触碰／超时判定、触感设置与最近 20 场本机战绩扩展，使用现有 `minigame/lib/duel-engine.js`、`game-app.js`、`storage.js` 和浏览器 Canvas 适配。两个入口对所有用户公开，不按审核身份或日期切换功能。

## 数据与网络行为

原版标题、双方昵称、自定义 TXT 彩头保存在当前浏览器 localStorage，读取时执行原作的 7 天有效期规则；最长等待时间独立保存且不过期。彩头密码、当前对局和无限模式记录保留在页面内存，刷新后不保留。当前运行代码没有麦克风调用或录音／回放功能，部署策略也明确禁用麦克风。音效由 Web Audio 合成，具体发声仍由浏览器和设备控制。

为保留原作 PV 功能，页面仍加载 `https://counter.bornforthis.cn/counter.js`，并使用原作的 `ai.bornforthis.cn` / `ReadyGoDuel` 统计标识；它是外部访问统计服务，页面并非零网络请求或完全本地处理。原作者链接仍指向 `https://bornforthis.cn/`。报告二维码改为同源文件，生成战报不再需要单独请求原二维码站点。报告由浏览器 Canvas 生成，可下载 PNG 或在移动端长按保存。

计分扩展不提供云备份入口或同步客户端，`match/local.js` 将共享界面的云备份能力关闭；其最近 20 场记录可通过“清除本机战绩”移除。原版设置与计分扩展记录使用各自的本机存储键；清理浏览器站点数据会同时清除这些存储。

## 构建

`projects.config.json` 登记为 React 模块，`scripts/build-web.js` 使用 esbuild 打包 `main.tsx` 为 `main.js`，使用固定版本 Tailwind 3.4.17 编译 `index.css` 为 `main.css`，复制 `index.html` 与 `assets/`。同一构建另外生成 `match/` 下的 HTML、脚本、基础样式与 Canvas `bundle.js`。原始快照与变换脚本不复制到发布目录。

## 本地验证记录

2026-10-21 使用 `node scripts/build-web.js` 成功构建；`node --test tests/ready-go-duel-web.test.js` 的 4 项检查通过：固定来源及获准变换、默认入口与计分扩展、无麦克风能力及禁用策略、实际音频合成函数的开始／GO／试听／抢跑／胜利音参数。

IAB 在 `http://127.0.0.1:4187/projects/ready-go-duel/` 实际验证了触摸入口、彩头输入、等待信号、A 键胜利及礼花、彩头揭晓、含原二维码的 PNG 战报、设置面板、无限首局／L 键抢跑／汇总，及 `/match/` 计分扩展入口。用户允许去掉声控后重新完成这些流程，并点击了设置中的试听按钮，控制台没有错误或警告。原 PV 挂件实际显示计数 200，重新打开后显示 201、202；这些是显示的访问计数，不是 HTTP 状态码。修复扩展头像的相对路径后重新打开，头像请求不再返回 404。浏览器未获得麦克风授权；没有将参数测试或按钮调用等同于设备扬声器的实际试听，也未部署或声称微信真机验收通过。

本机临时截图：`/tmp/brclio-readygoduel-original.png`、`/tmp/brclio-readygoduel-settings.png`、`/tmp/brclio-readygoduel-rewards.png`、`/tmp/brclio-readygoduel-waiting.png`、`/tmp/brclio-readygoduel-winner.png`、`/tmp/brclio-readygoduel-report.png`、`/tmp/brclio-readygoduel-infinite-summary.png`、`/tmp/brclio-readygoduel-match.png`。截图仅作当前本地审阅证据，不随站点构建发布。

原仓库使用要求及署名见根目录 `THIRD_PARTY_NOTICES.md`；本说明不添加原作未授予的许可证。本模块的原版界面按用户要求恢复原作，不以品牌模板重绘。
