# 图册首发指南

## 本次发布范围

版本 `0.1.0`。主体为个体工商户，微信普通小程序名称为「莆田市荔城区黄家蓉宝电脑店」，AppID `wx59aa532fbf6fa540`。用户提供的后台截图显示类目为「生活服务 → 婚庆服务」。本次实际功能为只读的 AI 婚纱灵感图册，不提供预约、报价、交易、评论或上传。

原生功能目录仅保留 `wedding-inspiration`，正式网页只构建 `web/wedding/`。旧反应挑战及备份源码保留开发使用，不进入本次网页的执行代码，也没有隐藏入口；旧脚本地址只返回注释占位，清退 CDN 可能残留的旧内容。`SYNC_ENABLED` 关闭，不使用私有 GitHub 仓库保存用户浏览数据。

图册 `0.1.0` 已重新上传，开发者工具明确显示「代码上传成功」，界面为 0 Errors／5 Warnings。当前代码 82 项测试和发布检查通过，代码包约 724.5 KiB；本地桌面及 390 px 移动视口的图册浏览检查通过，两幅图片均已加载。Worker 与 Pages 图册部署均成功。两个生产域名的页面、交互脚本、样式、两幅图片、校验文件及旧脚本注释占位均返回 HTTP 200，字节与本地产物一致；备份健康状态为关闭，创建备份会话返回 503。尚未完成微信真机验收，也未确认提交审核或正式发布。

## 网页与域名

1. 执行 `npm ci`、`npm run build`，检查 `dist/web` 的图册网页、两幅图片、样式／交互文件和业务域名校验文件。旧 `runtime.js`、`sync.js`、`bundle.js` 仅允许精确的无执行行为注释占位；发布检查会核验占位内容。
2. 执行 `npm run deploy` 发布 `https://pocket.brclio.com`，执行 `npm run deploy:wechat-web` 发布 Pages 工程 `brclio-miniapp-wechat`，供 `https://pocket.bornforthis.cn` 使用。
3. 检查两处首页均为婚纱灵感图册，图片、主题筛选和大图查看可用；不应提供旧互动内容或备份入口。
4. 检查 Worker 的 `SYNC_ENABLED: "false"` 已在生产生效，图册不请求会话、战绩或 GitHub 写入接口。

微信域名 DNS 为 `pocket.bornforthis.cn CNAME brclio-miniapp-wechat.pages.dev`，Cloudflare 状态已核验 active。本次最终部署后根目录 `jBK3p5zOBn.txt` 已复查为 HTTP 200，且与用户原文件字节一致；后续重新部署时仍应复查。用户已确认微信后台业务域名验证并保存完成。`miniprogram/config.js` 的 `webOrigin` 应保持 `https://pocket.bornforthis.cn`。

本次最终部署记录：Worker 版本 `c7bc280c-f599-400d-a101-bb1e534794f6`；Pages 部署 [ac0f46b9](https://ac0f46b9.brclio-miniapp-wechat.pages.dev)。本地图册交互已检查；线上浏览器自动化受工具安全检查阻止，因此当前线上证据为资源响应与字节核验，微信真机交互仍待验收。

## 上传与体验版

```sh
npm run build
npm test
npm run check:release
npm run wechat:open
```

开发者工具导入项目根目录，确认 `compileType: miniprogram`、上传目录 `miniprogram/` 与实际 AppID。图册 `0.1.0` 已通过工具界面重新上传。后续修改后仍应编译并检查首页、关于与隐私内容，再上传对应包。后台核对最新上传时间、版本说明与体验页内容，避免选择此前的旧同版本包。

可直接复制的版本描述：

> 首次发布婚纱灵感图册，提供花园与海岸主题的AI生成婚纱示例，支持风格筛选和大图浏览。图片仅供灵感参考，非真实客片，无需注册登录。

接下来在后台设置最新图册包的体验版，完成真机验收，再提交审核。审核通过后才可正式发布；每一步以实际后台状态为准。

## 真机验收

- iOS、Android 微信各至少一台：原生首页、图册卡片、网页打开与返回、关于和隐私均可用。
- 两张图片清晰加载，屏幕窄时文字不溢出，刘海、胶囊和底部区域不遮挡操作。
- 全部／花园／海岸筛选结果正确，大图可打开、切换和关闭，返回图册不丢失基本操作状态。
- AI 生成、非真实客片的说明在图册及关于页面清楚可见。
- 弱网、切后台和重新进入后可继续浏览；不出现旧反应挑战、云备份、登录、上传或交易入口。
- 网络面板只出现必要页面与图片请求，不写入用户档案或浏览记录，不请求旧记录 API。

## 审核与隐私填报

简介与审核说明如实填写「婚纱灵感图册」，说明两幅内容均为 AI 生成示意，供风格参考，并非真实客户案例。不把图册描述为已有婚纱摄影案例、可预约门店服务或在线交易平台。

当前不收集姓名、联系方式、微信身份或上传图片，不申请相关敏感权限，不创建云端用户记录。微信可能产生正常网页与图片缓存；Cloudflare 为完成网络请求可能处理 IP、请求时间及浏览器等必要信息。隐私说明、审核填报与实际实现保持一致。

联系邮箱为 `aiyuechuang@gmail.com`，服务提供者为账号实际主体。后台认证、备案和其他材料按真实账号要求完成；当前类目已显示获准不等于版本审核通过。

## 官方参考

- [web-view 组件](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)
- [小程序网络与域名](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/domain.html)
- [微信小程序运营规范](https://developers.weixin.qq.com/miniprogram/product/)
- [微信开发者工具下载](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
