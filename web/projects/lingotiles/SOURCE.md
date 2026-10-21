# LingoTiles 来源与适配

来源：[Brclio/brclio-lingotiles](https://github.com/Brclio/brclio-lingotiles)，固定提交 `a6a3841b846d72932301d43ddb9c30e756a22c7b`。

`SNAPSHOT.json` 记录 1,454 个原始文件的路径、字节数和 Git blob SHA-1。上游 `src/`、`PRODUCT.md`、`DESIGN.md` 按原字节保存在 `upstream/`；全部 `public/` 资源保存在本项目 `public/`。`tests/lingotiles-source.test.js` 逐文件复算 `SHA1("blob " + length + NUL + bytes)`，核对固定提交中的来源。普通构建不联网获取来源，也不随上游 main 自动改变。

完整词库为 100,000 个唯一词条，包含经典主题的 54 个精选词。分级课程、完整词典释义、查词索引与分片全部保留。图片为源提交已实际完成的 1,083 个义项，未完成的 98,917 个义项保持文字卡；图片必须同时匹配英文、词性和中文含义。不存在 100,000 张已完成图片的承诺。

网页适配位于 `src/`：游戏规则、进度、浏览器逐次历史、图片索引和主题数据保留上游实现；资源基址改到 `/projects/lingotiles/`，增加悦学返回入口、手机布局、状态切换滚动复位、中文联网错误反馈和回到选关的退出确认。`mobile.css` 在保留交互的基础上改为手机布局；大词库和图片按选关、单词本当前页及搜索触发读取。

原生构建入口为 `scripts/build-lingotiles-native.js`，重用固定上游规则与课程代码，通过显式注入的微信网络、存储、文件和图片适配替代浏览器能力，不修改全局 `fetch` 或 `localStorage`。当前原生页面为 `miniprogram/pages/lingotiles/`，页面和资源说明见 [功能对照](../../../docs/LINGOTILES_PARITY.md)。

网页资源随当前 Cloudflare Pages 项目部署；没有新增账号数据库、对象存储或图片生成服务。原生发音经同域固定代理访问有道词典，浏览器发音保留 Web Speech 能力。词库来源与设计署名见 [THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md)。
