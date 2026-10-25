# 内置头像

项目提供 1,000 张独立的 160 × 160 PNG 头像，稳定地址为 `/avatars/0001.png` 至 `/avatars/1000.png`。图片位于 `web/avatars/`，网页构建时复制到 `dist/web/avatars/`；小程序按需从现有网站域名加载，不将图片放入小程序主包。

图片由本仓库的 `scripts/generate-builtin-avatars.py` 确定性绘制，无下载、第三方头像 API 或字体依赖。10 种角色（猫、狐狸、熊、兔、熊猫、狗、青蛙、猫头鹰、企鹅、机器人）分别提供 10 套配色及 10 种配饰／表情，共 1,000 个互不重复的图片。图片不包含用户信息或逐张区别的文件元数据，唯一性来自实际图案。

色彩与页面交互沿用 [Brclio Design System](https://github.com/Brclio/brclio-design-system) 的暖底、蓝、黄及少量玫瑰红规范。

安装 Pillow 后，在仓库内运行以下命令可重建图片并核验目录、PNG 光栅、唯一性和 5 MiB 体积上限：

```sh
python3 scripts/generate-builtin-avatars.py
node --test tests/avatar-catalog.test.js
```

本次生成使用 Pillow 12.1.1，总图片体积 3,821,641 字节。不同 Pillow 版本的 PNG 编码字节可能不同，编号与绘制组合保持不变。

网页与小程序共用 `miniprogram/lib/avatar-catalog.js` 的编号、路径、名称及分页函数；页码从 0 开始，每页默认 40 张，最后一页到 1,000 号。账号后端保存编号，之后登录继续使用已保存的头像。
