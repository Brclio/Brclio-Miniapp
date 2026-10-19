# Brclio 口袋

微信普通小程序，首版提供只读的「婚纱灵感图册」。原生首页通过 `web-view` 打开图册，展示花园与海岸两种主题的 AI 生成婚纱示意图，供浏览氛围、色彩和造型参考。

**婚纱灵感图册 `0.1.0` 已部署到两个网页域名，并重新上传微信开发版本；82 项测试及发布检查通过。** 微信业务域名已由用户确认保存，线上资源与本地产物字节核对一致，旧备份服务关闭。尚未完成微信真机验收，也未确认提交审核或正式发布，详见 [验证记录](docs/VERIFICATION.md)。

- 公开网页：[pocket.brclio.com](https://pocket.brclio.com)
- 微信网页：[pocket.bornforthis.cn](https://pocket.bornforthis.cn)，使用已备案域名。
- 源码仓库：[Brclio/Brclio-Miniapp](https://github.com/Brclio/Brclio-Miniapp)
- 服务提供者：莆田市荔城区黄家蓉宝电脑店
- 联系邮箱：aiyuechuang@gmail.com

## 首版内容

- 原生首页仅有「婚纱灵感图册」功能入口，另有关于和隐私说明。
- 两幅 AI 生成示意图：「花间来信」与「与海相拥」。页面和图片明确标注 AI 生成，非真实人物客片或服务案例。
- 支持花园／海岸主题筛选、大图查看与切换。
- 无需注册或登录，不提供图片上传、评论、预约、报价或交易。
- 不创建用户档案，不保存用户浏览记录，不启用云备份；不申请微信头像、手机号、位置、相册、相机、麦克风或通讯录权限。

网页和图片由 Cloudflare 分发，正常网络请求与微信加载缓存仍会产生。当前不使用 GitHub 存储用户数据，也不接入广告或访问行为分析服务。

## 本地运行

需要 Node.js 20 或更新版本。

```sh
npm ci
npm run build
npm run dev:web
```

打开 Wrangler 输出的地址查看图册。`npm run build` 的正式产物包含 `web/wedding/` 图册与业务域名校验文件。旧脚本地址仅保留无执行行为的注释占位，防止 CDN 残留旧内容；不包含旧互动或备份客户端代码。

```sh
npm test
npm run check:release
npm run wechat:open
```

开发者工具导入项目根目录，配置已指向普通小程序的 `miniprogram/`，AppID 为 `wx59aa532fbf6fa540`。点击图册卡片访问配置的线上网页。CLI 预览、上传需要工具已登录并允许服务端口，也可直接使用工具界面。

## 部署

```sh
npm run deploy              # 构建并部署 Worker 静态网页
npm run deploy:wechat-web   # 构建并部署微信使用的 Pages 网页
```

`pocket.brclio.com` 使用 Worker 静态资源，`pocket.bornforthis.cn` 使用 Pages；两处发布相同图册。当前 `SYNC_ENABLED: "false"`，图册不调用旧记录 API，也不依赖 GitHub 凭据。微信业务域名必须与 `miniprogram/config.js` 一致；网页更新不替代微信审核。发布步骤见 [发布指南](docs/RELEASE.md)。

## 项目结构

```text
miniprogram/       微信实际上传目录：图册入口、web-view、关于、隐私
web/wedding/      当前正式图册页面、交互与生成图片
web/public/       微信业务域名校验文件
worker/           静态资源路由及当前关闭的历史记录 API
cloudflare/pages/ 微信图册的 Pages 部署配置
scripts/          构建、部署辅助、开发者工具和发布检查
tests/            当前入口测试及保留的开发模块回归测试
docs/             发布步骤与验证记录
minigame/         保留的早期反应挑战开发源码，不属于图册发布内容
preview/          早期开发预览，不属于图册发布内容
```

旧反应挑战、备份客户端和记录 API 保留作后续开发参考，不是当前首版功能。原生目录没有该功能入口，正式网页产物也不提供相关页面。后续新增功能须按实际服务内容更新类目、说明、隐私和审核材料。

设计和保留源码的来源要求见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
