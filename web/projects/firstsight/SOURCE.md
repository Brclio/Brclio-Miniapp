# FirstSight 摄影适配来源

- 上游：[AndersonHJB/FirstSight](https://github.com/AndersonHJB/FirstSight)
- 固定来源提交：`6fafcfd4371b00d8c956e58cb5bf689911b5fb2c`
- 上游页面：`pages/WeddingPage.tsx`（系列封面、系列详情、照片大图入口）
- 上游组件：`components/ImmersiveLightbox.tsx`（沉浸式大图、前后切换、触摸手势及滚动恢复）
- 上游类型：`types.ts` 中的 `WeddingSeries` / `Photo`，本适配仅保留当前只读图册需要的字段。

本目录是上述摄影模块的精简适配，并非完整原站镜像。保留“系列封面 → 影集详情 → 大图浏览”的交互结构；以项目内 CSS 替代原站 Tailwind 样式，提供键盘焦点管理、系统字体和本域素材。外层使用 Brclio Design System 的 App 模板基础变量与页头结构（© Brclio，CC BY-NC-SA 4.0）。

没有导入上游家庭、儿童、个人信件、短文、留言系统、文章、视频、生成分享明信片或虚构 EXIF 信息。原站的 `data/index.ts` 总出口未使用，避免把不属于本次发布范围的个人内容打入浏览器产物。

## 图片

当前两组影像各一张，均使用项目已有 AI 生成图片，不使用上游外部图库或演示视频。人物为虚构成年人，页面、图片替代文本与大图均注明“AI 生成”“非真实客片”。生成提示词与素材说明见 [`../../wedding/ASSETS.md`](../../wedding/ASSETS.md)。

构建过程复制：

- `web/wedding/assets/garden.jpg` → `/projects/firstsight/media/garden.jpg`
- `web/wedding/assets/coast.jpg` → `/projects/firstsight/media/coast.jpg`

## 构建约定

入口为 `main.tsx`，依赖 React 18、React DOM 18 与 `lucide-react`。入口导入 `style.css`；esbuild bundle 输出 `main.js` 和 `main.css`。将本目录 `index.html` 与两张图片复制至对应输出路径即可。所有浏览所需代码与图片均从同域加载，不依赖评论服务、Google Fonts、第三方图片 CDN 或动态脚本 CDN。

集合详情使用固定 hash 路由（`#/album/garden`、`#/album/coast`），支持直接进入、返回列表及浏览器后退；`/` 链接返回 Brclio 内容空间。
