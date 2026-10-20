# Brclio 悦创 0.1.0 验证记录

日期：2026-10-20（Asia/Shanghai）。AppID `wx59aa532fbf6fa540`，普通小程序。当前摄影、放松、我的均为原生页面；本记录替代此前错误来源与 0.1.1 的验收结论。[历史记录](archive/VERIFICATION-before-native-redesign.md) 仅供追溯。

## 名称统一更新

用户在微信后台将名称改为「Brclio 悦创」后，已同步原生导航、首页、分享标题、关于与隐私、返回入口、共享游戏品牌以及独立网页标题。AppID、法律服务主体、照片、玩法与本机存储键保持不变。构建、120项既有测试与发布检查通过；本次日志为 `artifacts/rename-build.txt`、`artifacts/rename-tests.txt`、`artifacts/rename-release-check.txt`。

网页已更新为 [06e54fb2](https://06e54fb2.brclio-miniapp-wechat.pages.dev)，两个现有域名各11个核心资源与本地产物哈希匹配，品牌检查及各4个接口/停用路径状态通过，总计30／30。没有重新处理照片；最终报告为 `artifacts/rename-production-check.json`。微信开发者工具中已确认首页与原生顶部标题均为「Brclio 悦创」，最终0.1.0开发包界面显示“代码上传成功”。上传备注以「Brclio 悦创 0.1.0」开头，截图为 `artifacts/wechat-upload-0.1.0-yuechuang.png`；上传目录234个文件的指纹为 `artifacts/rename-native-manifest.json`。本次未代替用户提交审核。以下旧部署和截图为此次名称同步前的验收记录。

## 当前摄影与游戏

- 摄影来源为 `AndersonHJB/FirstSight_Online` 固定提交 `988cc8d0208ac2cae87b0e36b072007a856356ab`。9 组真实相册、169 张照片：婚纱 8 组128张，孕期 1 组41张；没有旧网站样例或 AI 图片。
- 上游优化 WebP 共 20,325,346 字节，169 个文件均核验 Git blob 与 SHA-256。原生端另行生成最长边1024的 JPEG，并随四个摄影分包发布；封面随主包发布。原始 JPG 不进入客户端。
- 已取消“查看原图”、远程原图地址、复制链接和相关网络调用。大图预览始终使用包内压缩文件；相册模板只维护 `native/album/` 一份，构建复制到分包。
- 放松中的同屏双人反应挑战直接使用原生 Canvas；支持 1／3／5 分、抢跑和平局。偏好与最近20场战绩保存在微信本机缓存，可清除，没有账号或云备份。我的页为访客状态，注册登录尚未实现。

## 构建、自动检查与界面

完整测试120／120通过，`npm run check:release` 通过。日志为 `artifacts/redesign-tests.txt`、`artifacts/redesign-release-check.txt`。普通构建离线运行；显示图片、来源字节和清单分别校验各自哈希。最终主包600.8 KiB，四个摄影分包1631.3／1213.0／1584.4／1750.0 KiB，均低于2 MiB；全部代码及素材6779.5 KiB。

微信开发者工具中已验证：摄影列表9／169、婚纱8与孕期1筛选、孕期41张，进入本地大图、放大、切换后还原、关闭及返回；原生游戏Canvas正常渲染。未将模拟器当作微信客户端真机证据。相关截图：

- `artifacts/native-gallery-final.png`
- `artifacts/native-local-photo-final.png`
- `artifacts/native-duel-ready.png`

## 开发包上传与正式发布范围

微信开发者工具使用版本 `0.1.0` 和九组169张、内置反应游戏的准确备注上传，界面明确显示“代码上传成功”。首次上传的成功截图为 `artifacts/wechat-upload-0.1.0-native-final.png`。区分源图与JPEG哈希字段后，18:06再次上传同版本；工具后台在18:06:41记录 `progressSuccess`，最终证据为 `artifacts/wechat-upload-0.1.0-final-result.json`。命令行服务端口保持关闭，通过工具界面完成上传。

开发包上传完成不代表体验版已设置、审核已提交、审核通过或正式上线。尚需微信后台设置体验版、iOS／Android真机验收，并按真实反应玩法确认类目与资质。历史“生活服务 → 婚庆服务”不能作为覆盖该玩法的依据。小程序备案也需单独核对。

## 改名前的独立网页验收

同一 Pages 项目 `brclio-miniapp-wechat` 仅输出两个 active 模块：FirstSight、Ready GO Duel。改名前功能验收部署为 [1aaaac97](https://1aaaac97.brclio-miniapp-wechat.pages.dev)，访问域名为 [pocket.bornforthis.cn](https://pocket.bornforthis.cn) 与 [pocket.brclio.com](https://pocket.brclio.com)。网页部署与微信小程序发布分别处理。

两个域名各178个资源的正文 SHA-256 均与构建产物匹配，共356项：全部169张WebP、门户5项、摄影HTML／JS／CSS3项及业务校验文件1项。最终部署仅增加当前169图片路径白名单，以上静态文件零字节变化；复核每域11个核心资源及当前WebP，共22项仍匹配。

旧来源JPG缓存路径已被明确拦截，两个域名均返回404；健康接口版本0.1.0、`syncAvailable: false`，旧记录API返回503，停用AI模块、未知模块及旧替代图目录均返回404。最终状态复核共34／34通过。证据为 `artifacts/redesign-final-production-hashes.json`（完整静态哈希）与 `artifacts/redesign-final-cache-retirement-recheck.json`（旧缓存修复后的最终复核）。

## 数据边界

本轮没有使用聊天中提供的token，没有访问 `BrclioData/Brclio-Miniapp-Data`，也没有新增任何云端用户记录。客户端和构建产物凭据检查通过。未来账号方案与数据边界见 [ACCOUNT_PLAN.md](ACCOUNT_PLAN.md)，正式发布步骤见 [RELEASE.md](RELEASE.md)。
