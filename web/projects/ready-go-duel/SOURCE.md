# 双人反应挑战

- 原作：[AndersonHJB/ReadyGoDuel](https://github.com/AndersonHJB/ReadyGoDuel)
- 作者：AI悦创／AndersonHJB
- 固定参考提交：`e3efd5f3c1f40ac780cce0ff170b904922b1acf5`
- 当前模块使用仓库中已实现的 `minigame/lib/duel-engine.js`、`minigame/lib/game-app.js` 和 `minigame/lib/storage.js`，通过 `scripts/bundle-game.js` 打包到浏览器。
- 浏览器适配与基础样式复用 `web/runtime.js`、`web/style.css`；品牌头像来自 `minigame/assets/avatar.png`。

当前入口公开提供双人同屏反应挑战：选择 1 / 3 / 5 分赛制，等待明确信号后点击各自区域，包含抢跑、同时触碰、超时处理及本机战绩。页面不会根据审核身份或时间隐藏、替换功能。

本模块没有云备份入口、同步脚本、API 配置或网络上传功能。赛制、触感设置与最近 20 场完整对决记录保存在当前设备浏览器缓存，可通过模块内“清除本机战绩”移除；清理浏览器缓存可能一并清除。`local.js` 将共享渲染界面的云备份能力标记设为关闭，使隐私说明与实际行为一致。加载页面本身仍需请求本域静态文件；手动分享使用当前浏览器或微信提供的分享能力。

底部“返回内容空间”指向 `/?category=relax`，在布局中单独占位，不覆盖挑战触控区，并预留设备底部安全区域。

原仓库使用要求及署名见仓库根目录 `THIRD_PARTY_NOTICES.md`；本说明不添加原作未授予的许可证。

## 构建文件

复制本目录 `index.html`、`local.js`、`page.css`；另生成或复制：

- `bundle.js`：共享逻辑打包结果。
- `runtime.js`：`web/runtime.js`。
- `style.css`：`web/style.css`。
- `assets/avatar.png`：`minigame/assets/avatar.png`。

所有依赖均使用同域相对路径，不引入外部代码 CDN。
