# 2026-10-22 悦学增量验收

「悦学 / 词了个词」已完成源码接入、242 项测试、发布检查、网页正式域名端到端验证、1,425 个在线资源字节校验及微信模拟器真实通关。最终网页与远程资源部署为 [ae91a338](https://ae91a338.brclio-miniapp-wechat.pages.dev)。当前小程序 request 合法域名校验仍未通过；本轮没有上传包含悦学的新开发包、提交审核或正式发布。完整证据和待办见 [LINGOTILES_VERIFICATION.md](LINGOTILES_VERIFICATION.md)，功能与来源对照见 [LINGOTILES_PARITY.md](LINGOTILES_PARITY.md)。以下历史记录保留各自阶段边界。

# 2026-10-21 小程序 0.1.1 开发包上传

23:42（Asia/Shanghai），微信开发者工具 Stable `2.02.2608080` 明确显示“代码上传成功”。本次版本 `0.1.1`，AppID `wx59aa532fbf6fa540`，源码提交 `7cc2bfa22b920bec537804738a022f9d68f72667`，上传备注涵盖 169 张摄影、触摸／无限挑战、原音效、品牌战报真实小程序码、独立计分和可选账号备份。截图为 `artifacts/ready-go-duel/wechat-upload-0.1.1-success.png`，本地源码清单为 `artifacts/ready-go-duel/wechat-0.1.1-source-manifest.json`。清单记录 385 个本地源文件；微信编译和无依赖过滤可能改变实际传输包，不能将本地清单冒充上传二进制指纹。

版本配置已统一；构建、174 项测试及发布静态检查通过。新版对局流程见 [READY_GO_DUEL_PARITY.md](READY_GO_DUEL_PARITY.md)。原生账号页已实际打开并修复输入框超出手机宽度的问题；但进入账号页仍报 `https://pocket.bornforthis.cn` 不在 request 合法域名列表。用户回复已配置并提供业务域名截图；重新打开项目后开发工具仍报该错误，因此不能将此记录写成原生账号已联通。业务域名和服务器 request 域名须分别核对，未关闭 `urlCheck` 或更改微信安全设置。

业务域名校验文件 `web/public/jBK3p5zOBn.txt` 自初始提交起保留，本轮无删除；构建副本逐字节一致，SHA-256 为 `b43069dff9b50df306cc836e7261f96a60cac3a4ac51622f1680514f93999090`。当前自动客户端访问两个 pocket 域名的该文件、首页和健康接口均返回 HTTP 403、Cloudflare `error code: 1010`，是边缘对当前客户端的访问限制，不能据此断言校验文件在线丢失，也未验证微信校验服务器是否受到相同限制。本轮没有更改 Cloudflare 安全配置或部署 Pages。

用户已授权提交审核；Computer Use 明确禁止访问 `mp.weixin.qq.com`，包括用户已经打开的后台标签。本轮已完成开发包上传，后台体验版设置、审核提交和正式发布均未执行，需用户接管。下方 Pages 生产与账号联调记录属于另一阶段，不等同于本次微信客户端验收。

# 2026-10-21 共享账号验收记录

当前 Pages 生产部署为 [21884f14](https://21884f14.brclio-miniapp-wechat.pages.dev)，已包含本轮存储无损往返窄修；`8a60550b` 仅保留为早期账号验收历史。固定 `https://pocket.bornforthis.cn` 账号代理已与中央 `https://tools.brclio.com` 完成真实隔离测试账号联调。Pages 是网页/代理部署，不是微信小程序上传或正式发布。

中央后端当前 Worker 为 `16cc4a6e83854cf185940a03bdd9182f`，生效版本 `8bc269ab-a742-4459-95f5-9bc5db22212e`。账号与个人应用数据存 `BrclioData/BrclioUserData`，全局程序配置存 `BrclioData/BrclioData`；分库代码、两库当前 main 副本清理及全局配置路由已核验。分库后中央/pocket 的三次登录、跨用户/跨应用隔离、读写、并发 200/409、无效越权和退出后 401 再次通过；verification 为 262 项，含最终清理 result 为 692 项，2 个 fixture、7 个文件和 4 条索引已清理，stderr 为零。

最新本地 `npm test` 为 **174/174**，`npm run build` 与 `git diff --check` 通过。本轮窄修将玩家名往返统一到 16 字符，游戏保存保留未知本地字段，存储读取失败或缓存根格式异常时拒绝覆盖；新增恢复后通过共享网页/原生实际游戏按钮保存、再备份的回归。该修复已随上述 Pages 部署在线生效。

生产复核覆盖 `pocket.bornforthis.cn` 与 `pocket.brclio.com`：每域的 `/`、`/projects/ready-go-duel/`、`/projects/ready-go-duel/match/bundle.js` SHA-256 均与本地产物完全一致，native 方式匿名 `/api/account/session` 返回 200、`/api/account/apps/miniapp/data` 返回 401。每域 5 项、共 10 项通过，安全证据为后端仓库的 `artifacts/miniapp-split-release.safe.json`。

分库后测试 fixture 清理完，3 位既有用户的原 10 个账号 blob 和 3 个派生 Brclio blob 原始 SHA 全部一致，UserData tree 与固定清理提交 `ad6840ca7dc2eeb35b862d5639350c12db171ba7` 相同；ProgramRepo 原全局配置 SHA 也保持一致。固定分离提交作为内容证据，后续文档提交 head 不写回本记录。

微信开发者工具本轮 UI 操作返回 `noWindowsAvailable`；新原生账号页仍无 fresh 编译、上传、提交审核或发布证明。Google/邮件的配置就绪检查不等于真实邮件注册或 Google 新注册验收，本轮没有这两类完成证明。

## 同日前一轮源码接入记录（历史阶段）

下列“未部署 Pages/未生产联调”仅描述当时源码准备阶段，已由上面的最新部署与联调记录补充；其中本机 IDE 操作和微信发布的证据边界继续有效。

新增原生共享账号页、固定 Pages 代理与挑战数据手动备份/恢复，详见 [ACCOUNT_PLAN.md](ACCOUNT_PLAN.md)。默认游玩仍使用本机缓存。账号接入使用中央账户服务和 `BrclioData/BrclioUserData`，不再使用旧的小程序专库方案。

本次 `npm test` 通过 141 项测试，其中账号、代理与页面相关 21 项；`npm run build`、`npm run check:release` 和 `git diff --check` 通过。主包 629.6 KiB，四个摄影分包均低于 2 MiB。该轮仅有源码、本地 mock 和构建证据，未部署 Pages、上传小程序或写入真实用户数据。微信 request 域名白名单、中央服务生产联调、隐私审核和真机验收仍须逐项确认。

账号生命周期回归覆盖：旧页面登录迟返回不能覆盖新页面已登录账号；旧 refresh、logout 和 401 回复不能改写或清除新会话；登录再退出后，旧匿名登录回复不能恢复会话。会话采用持久化 generation 比较与更新，退出后仅留下无 token 的代际标记。页面卸载调用 `dispose()`，使旧操作失效并中止 `wx.request`；恢复确认后的第二次云端读取即使迟返回，也不能写恢复副本或本机挑战数据。备份成功回复还必须匹配当前用户、应用、协议版本和下一 revision。离线挑战记录与偏好保持保留。

2026-10-21 运行 `npm run wechat:doctor`，确认本机已安装开发者工具 CLI、工程为普通小程序，AppID 为 `wx59aa532fbf6fa540`。随后只读 `cli islogin` 返回退出码 246，原因是 IDE 服务端口已关闭；因此不能确认当前 CLI 登录状态，也没有本轮真实微信编译、预览、上传或正式发布证据。未启用服务端口或改变微信工具安全设置。后续可在 IDE 中将自定义编译路径设置为 `pages/account/index`，核验编译输出与 Console；CLI 可用后再分别执行预览和上传。

同日通过 CUA 读取微信开发者工具原生窗口，确认已打开的 `Brclio-Miniapp` 项目为本仓库根目录，对应本次 `miniprogram` 工程。模拟器显示已有首页，调试器显示 Errors 0、Warnings 5。对截图定位的“普通编译”按钮执行一次点击时，CUA 返回 `Computer Use server error -10005: noWindowsAvailable`；随后仍可只读查看窗口，但重新选择工具实例又超时，因此停止操作。已有首页及 Errors 0 不能作为本次新账号页真实编译成功的证据；本次没有成功触发并核验新的编译结果，仍未上传、提交审核或发布，也未启用服务端口、改变安全设置或修改项目源码。

下文为此前版本的历史发布记录，其“无账号/无云备份”描述和既有上传截图仅适用于当时版本，不证明本轮共享账号能力已经发布。

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
