# 0.1.0 发布步骤

小程序名称「Brclio 悦创」。普通小程序 AppID `wx59aa532fbf6fa540`，主体「莆田市荔城区黄家蓉宝电脑店」。本轮按用户指定发布版本 `0.1.0`；此前 `0.1.1` 是历史开发记录，不作为本轮发布证据。

## 最终内容

摄影、放松、我的均为原生页面。摄影只使用 FirstSight_Online 固定提交的 169 张实际照片：8 组婚纱 128 张、孕期 41 张。主包内置封面，四个摄影分包内置 JPEG 展示文件与相册页面；支持本地大图缩放。没有原图查看入口，不依赖原图网站。放松为原生 Canvas 双人反应挑战，支持 1／3／5 分、抢跑、平局与本机战绩。原生账号页已接入共享账号与手动挑战备份；当前源码能力与生产发布状态须分别验收。

## 构建与包体检查

```sh
npm run build
npm test
npm run check:release
```

普通构建离线运行；不需要访问私库或配置 Secret。维护原生相册只修改 `native/album/`，构建会复制到全部摄影分包；不要手改生成页面。更新图片时先按 [SOURCE.md](../web/projects/firstsight/SOURCE.md) 显式同步，再运行 `npm run prepare:photos`。

检查主包、每个摄影分包低于 2 MiB，全部代码与素材低于项目 20 MiB 预算；来源图、原生展示图和封面必须分别与各自清单中的哈希一致。根目录真实 AppID、普通小程序类型、`urlCheck: true` 保持不变。

## 微信开发工具与上传

```sh
npm run wechat:open
npm run wechat:preview
npm run wechat:upload
```

命令行需要开发者工具服务端口已开启。本轮若端口关闭，可直接使用工具界面编译、预览和上传，无需改变安全设置。上传版本读取 package.json。可使用以下说明：

> Brclio 悦创：摄影、放松、我的三个原生入口。内置 FirstSight_Online 九组169张实际摄影、可缩放大图与同屏双人反应挑战；图片随代码分包，默认本机保存战绩；可选 Brclio 共享账号，确认预览后手动备份与恢复挑战数据。无需 web-view，不获取微信身份。

验收后上传开发包，并在微信后台设置体验版。iOS、Android 微信均应验证以下项目：

- 全部／婚纱／孕期计数 9／8／1；169 张本地展示图与来源相符，孕期相册完整 41 张。
- 相册进入、滑动、缩放、首末边界、关闭、返回筛选和分享正常；无原图按钮、AI 样例或外部照片请求。
- 双人挑战 GO、抢跑、近同时触摸、超时、先得 1／3／5 分正确；后台和退出取消当前回合，不意外计分。
- 本机战绩重进保留，记录清除有效；卸载页面释放计时器、动画帧与常亮。
- 共享账号注册、登录、失败/失效、资料与密码更新、退出正常；退出保留本机记录。
- 手动备份和恢复展示目标账号、记录数量与覆盖方向，取消不写入；冲突保留本机并要求重新读取。恢复前副本保留于本机，跨账号会话不能读写他人备份。
- `pocket.bornforthis.cn/api/account/session` 原生请求经固定代理返回 JSON；确认 GitHub PAT、Cookie、任意 URL 均不能被代理或写入客户端。
- 胶囊、刘海、底部安全区不遮挡；代码分包首次下载与缓存清理后的恢复正常。

## 备案与类目

小程序本身备案与网站域名备案分别核对。原生账号与手动备份固定请求 `https://pocket.bornforthis.cn`，需在微信后台配置 request 合法域名；此源码修改不证明该配置或微信隐私审核已经完成。Pages 代理部署后须与中央账号服务联调验证，摄影与游戏仍可本机运行，无 web-view。

竞技互动必须按真实玩法核对类目、资质与产品形态。已知历史后台类目为「生活服务 → 婚庆服务」，不能据此认定覆盖反应游戏。若普通 AppID 不支持实际玩法，应使用符合要求的小游戏账号；改称「放松」或内置 Canvas 都不改变实际内容。确认要求后提交审核，审核通过后正式发布。

## 独立网页

`npm run deploy` 只发布同一 Pages 项目的摄影与反应挑战网页，不会发布微信小程序。核对两域名清单、169 个优化 WebP、HTML／JS／CSS、校验文件与健康接口；确认停用 AI 示例、未知项目、旧图片路径返回 404，旧记录 API 返回 503。生产结果写入 [VERIFICATION.md](VERIFICATION.md)，不能把网页部署当作微信正式上线。

官方参考：[Canvas 2D](https://developers.weixin.qq.com/miniprogram/dev/component/canvas.html)、[分包规则](https://developers.weixin.qq.com/miniprogram/dev/framework/subpackages/basic.html)、[小程序网络](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/network.html)、[运营规范](https://developers.weixin.qq.com/miniprogram/product/)。
