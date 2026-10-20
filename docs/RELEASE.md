# 内容空间发布指南

## 当前版本范围

目标版本 `0.1.1`。微信普通小程序 AppID 为 `wx59aa532fbf6fa540`，主体为个体工商户，后台名称为「莆田市荔城区黄家蓉宝电脑店」。已知后台类目为「生活服务 → 婚庆服务」，不能据此认定新增互动已满足发布要求。

首页栏目固定为「摄影」「放松」，均有实际项目。摄影包含 FirstSight 摄影适配版和婚纱灵感图册，两张图片为 AI 示例、非真实客片；放松包含双人反应挑战，两人在同一设备等待 GO 后触摸，支持 1／3／5 分赛制、抢跑判定、平局及最近 20 场本机记录。无登录、上传、评论、预约、交易或云备份。

`0.1.1` 三模块最终部署 [24751c99](https://24751c99.brclio-miniapp-wechat.pages.dev) 成功，两个自定义域名均为 active，已测资源与本地产物字节一致。93／93 项测试和发布检查通过，原生包约 216.3 KiB。微信开发者工具已成功上传 `0.1.1`，界面为 0 Errors／5 Warnings，代码质量良好。尚无审核提交、审核通过或正式发布证据，见 [VERIFICATION.md](VERIFICATION.md)。

## 统一部署与停用控制

1. 核对 `projects.config.json` 与 `web/portal/projects.json`：摄影两个 `active` 项目，放松一个 `active` 项目，每张卡片对应 `/projects/<id>/`。
2. 运行下列检查，在本地验证栏目切换、两个图册、反应挑战、返回路径、本机记录和清除。
3. 执行 `npm run deploy`，只部署 Pages 项目 `brclio-miniapp-wechat`。`npm run deploy:wechat-web` 为同一流程别名。
4. 核对生产清单、三个模块入口及其 JS／CSS／图片和校验文件，与本次产物一致。
5. 核对 `/api/health` 为当前版本且 `syncAvailable: false`；旧记录接口不可用，互动记录不发生网络上传。
6. 对未开放的测试路径验证 404。构建只输出 `active` 模块，Pages 服务在 `ASSETS` 前按编译清单拒绝未开放路径；停用项目必须重新构建部署，不能只从首页隐藏卡片。

```sh
npm ci
npm run build
npm test
npm run check:release
npm run dev:web
```

所有模块使用同一个 Cloudflare Pages 项目。公开域名 DNS 的 CNAME 修改已由用户确认，两个域名绑定状态均已核验 active。旧 Worker 的公开域名绑定已解除，域名列表为空；`workers.dev` 与预览入口已通过 API 停用。旧配置归档在 `cloudflare/legacy-worker/`，当前发布命令不部署它。

## 微信域名与备案

微信只使用 `pocket.bornforthis.cn`，沿用用户已备案的 `bornforthis.cn`，DNS 指向 `brclio-miniapp-wechat.pages.dev`。用户已确认微信后台业务域名保存。公开网页 `pocket.brclio.com` 不作为本次微信业务域名，不能替代已备案的微信入口。

增加模块使用 `/projects/<id>/` 即可，不需要每个模块新建域名。每次更新后核对根目录 `jBK3p5zOBn.txt` 与原校验文件字节一致；同时确认小程序实际加载的所有必要地址符合后台配置要求。

## 微信上传与审核

```sh
npm run wechat:open
```

开发者工具导入根目录，确认普通小程序类型、代码目录 `miniprogram/` 和实际 AppID。编译后验证 `content-hub`、`firstsight`、`wedding-inspiration`、`relax`、`ready-go-duel` 各固定 ID：放松应进入对应栏目，反应挑战应公开可见并正常运行。核对原生和网页隐私说明中的本机记录范围。本次 `0.1.1` 已上传成功；后续改动时重新检查并上传对应包，后台应选择最新同时包含摄影和反应挑战说明的开发版本。

可复制的简短审核说明：

> 摄影包含 FirstSight 与婚纱图册，图片为 AI 示例、非真实客片；放松提供同屏双人反应挑战，等 GO 后点击，支持 1／3／5 分和抢跑判定，本机保存最近 20 场。无需登录，不上传记录，无云备份。

剩余步骤是在后台核对最新开发包、设置体验版并完成微信真机验收，确认新增互动对应要求后按实际内容提交审核。开发包上传成功不等于提交审核或正式发布。双人同屏竞技玩法应在审核资料中明确说明，不能用「放松」栏目名代替真实功能描述。提交前核对该互动的类目、资质与产品形态要求；若平台要求对应类型账号或材料，应按实际要求处理。现有婚庆类目和网页部署都不代表新增互动已获准，也不能保证网页更新免审核。

## 验收清单

- iOS／Android 微信各至少一台：原生入口、两个栏目与三个模块打开及返回正常，项目计数正确。
- FirstSight 封面、详情、大图、手势、前后切换和关闭正常；婚纱图册筛选和大图正常；AI 标注清楚，无私人内容或外部演示媒体。
- 双人反应挑战等待 GO、抢跑、35 ms 近同时触碰、5 秒无人响应和 1／3／5 分结算正确，不重复计分。
- 切后台、暂停、锁屏或改变视口不意外计分；返回内容空间保留正确栏目。
- 本机记录重载后保留，超过 20 场按范围保留；清除记录有效，不显示云备份入口或上传请求。
- 页面与触控区不被胶囊、刘海或底部返回栏遮挡；弱网与目录失败可重试。
- 未开放模块直接访问返回 404；客户端无服务凭据、行为分析或旧记录 API 调用。

## 隐私与材料

当前不收集姓名、联系方式、微信身份或上传图片，不申请微信头像、手机号、位置、相册、相机、麦克风或通讯录权限。摄影只读；反应挑战在浏览器本地保存赛制、触感偏好和最近 20 场对局的时间、比分与反应成绩，可在模块内清除。清理微信缓存或网页存储可能删除本机记录与偏好。

对局记录不上传 Cloudflare 或 GitHub，不提供云备份或云端用户档案。页面加载仍需网络请求，Cloudflare 可能处理必要网络信息，微信可能产生加载缓存。隐私说明、关于和审核材料应与当前实际实现一致，联系邮箱为 `aiyuechuang@gmail.com`。

## 官方参考

- [web-view 组件](https://developers.weixin.qq.com/miniprogram/dev/component/web-view.html)
- [小程序网络与域名](https://developers.weixin.qq.com/miniprogram/dev/framework/ability/domain.html)
- [微信小程序运营规范](https://developers.weixin.qq.com/miniprogram/product/)
