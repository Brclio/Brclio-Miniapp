# 儿歌陪伴 · 歌曲封面

47 首歌曲各使用一次独立的内置 `image_gen` 图像生成请求，未使用 API/CLI 回退，未使用网格切割、复制同一封面或程序绘图代替生成。每张对应的完整提示词、来源输出标识、原图 SHA256、成品 SHA256 与压缩参数记录于 [manifest.json](manifest.json)。

视觉规范为暖纸底的水粉和蜡笔童书插画，蓝色细节搭配克制的黄色、红色；歌曲意象是清楚的大主体，不将文字画进封面。歌曲名由原生界面显示。角色为原创插画，不使用商业角色标识。

- 小程序成品：`miniprogram/nursery/assets/covers/<歌曲ID>.jpg`，256×256。
- 系统播放器远程封面：`https://pocket.bornforthis.cn/assets/nursery-covers/<歌曲ID>.jpg`，由本项目构建复制相同字节。
- 原始图像在本地 `artifacts/nursery-covers/originals/` 归档；生成器最初输出继续保留在 `$CODEX_HOME/generated_images/`。原图不进入微信代码包或 Git。
- 育儿页面与图片使用独立 `nursery` 分包；音乐 MP3 仍从用户指定的既有音乐域名播放。

构建直接使用已提交的 JPEG，无需再次生成。若本地原始归档仍在，可按同一参数重新压缩：

```sh
python3 scripts/prepare-nursery-covers.py
npm run build
node scripts/check-nursery-covers.js
```

完整音频核验可使用 `node scripts/check-nursery-music.js --full`，会联网逐首流式核对原 MP3 SHA256，不保存或修改音频文件。
