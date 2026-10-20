# FirstSight 摄影来源与素材清单

- 私有上游：[AndersonHJB/FirstSight_Online](https://github.com/AndersonHJB/FirstSight_Online)
- 固定提交：`988cc8d0208ac2cae87b0e36b072007a856356ab`
- 婚纱系列：`data/wedding.ts` 的 8 个原有系列，共 128 张
- 孕期系列：`data/photoAlbums.ts` 的 `pa-pregnancy` 权威合集，共 41 张；核对其图片路径与 `data/baby.ts` 的 `BABY_PHOTOS_PREGNANCY` 完全一致，应用内固定 ID 为 `pregnancy`
- 类型与优化规则：`types.ts`、`utils/image.ts`
- 来源快照：[`upstream/`](upstream/)，逐文件 SHA-256 与 Git blob SHA-1 见 [`upstream/SNAPSHOT.json`](upstream/SNAPSHOT.json)
- 原文件和优化文件的逐路径映射：[`upstream/BLOBS.json`](upstream/BLOBS.json)
- 标准化分组和逐图片核对清单：[`original-data.json`](original-data.json)
- 导入工具：[`scripts/sync-firstsight.mjs`](../../../../scripts/sync-firstsight.mjs)

导入仅保留真实婚纱与孕期照片。没有导入 Unsplash 图片、旧摄影画廊、家庭与旅行样例、宝宝成长样例、重复的 `pa-wedding` 聚合相册、视频或 EXIF。婚纱系列的原始标题、描述、日期、标签、作者和分组顺序保留；孕期采用 `photoAlbums.ts` 合集的标题、描述、日期与地点，不混用 `baby.ts` 中不同的示例说明，也不推测或生成拍摄参数。

## 素材版本

应用使用固定提交内的 **优化 WebP 文件**，不是体积较大的原始 JPG/JPEG，也不重新压缩优化文件。映射遵循上游 `utils/image.ts`：原公开路径去除扩展名后，映射到 `/optimized` 下的同名 `.webp`。例如 `/婚纱照/海边/3Z2A0012.jpg` 对应 Git 路径 `public/optimized/婚纱照/海边/3Z2A0012.webp`。

169 个优化 WebP 共 **20,325,346 字节**，全部可用。文件通过现有 `gh` 认证、按固定 Git blob 精准读取，以四个并发下载；不克隆整个仓库，不读取或嵌入聊天中的凭据，不把认证信息放入前端。

每张素材记录：

- `originalUrl`：上游原公开路径；`sourceOriginalPath`：原 JPG/JPEG 的 Git 路径。
- `sourceOriginalBlobSha`、`sourceOriginalBytes`：Git tree 记录的原文件标识和字节数；本应用没有下载这些大原片。
- `sourceOptimizedPath`、`sourceBlobSha`、`sourceBytes`：实际下载的优化 WebP 路径、Git blob SHA-1 和字节数。
- `sha256`、`bytes`、`width`、`height`：实际保存的优化 WebP 字节的 SHA-256、字节数和解析尺寸。
- `url`：本模块 `/projects/firstsight/assets/original/<hash>.webp` 兼容路径。目录名沿用原适配结构，其中存放的是上述优化 WebP，不表示原 JPG。

## 导入范围

| 系列 | 原分组 ID | 张数 |
| --- | --- | ---: |
| 海边誓约 | ws1 | 13 |
| 法式回廊 | ws2 | 16 |
| 韩式心动 | ws3 | 9 |
| 喜嫁红幕 | ws4 | 8 |
| 街角恋人 | ws5 | 14 |
| 明制凤冠 | ws6 | 34 |
| 古堡光影 | ws7 | 12 |
| 主纱鎏光 | ws8 | 22 |
| 倾听你的心跳 | pregnancy | 41 |
| 合计 | 9 组 | 169 |

所有封面均来自相应原系列，不使用替代图片。旧样例素材及旧来源快照仅在本导入器拥有的 `assets/original/` 与 `upstream/` 目录内清理，其他素材目录不受影响。

## 重复导入

正常构建只读取已提交的数据和素材，不联网。

```sh
# 离线校验固定来源快照、优化图片 Git blob 与尺寸，并确定性重建数据。
node scripts/sync-firstsight.mjs

# 显式联网：通过已登录 gh 的 Git tree/blob API 读取固定提交。
node scripts/sync-firstsight.mjs --download
```

离线模式不会调用 `gh` 或访问网络；缺少快照或素材、内容校验失败时会明确报错。显式下载会先取得完整且未截断的固定 Git tree，核对每个来源文件与素材 blob 的 Git SHA-1；本地已有且校验正确的优化图直接复用。下载结果再次计算 SHA-256、解析 WebP 尺寸，并生成逐图片状态。源文件仅在无文件系统、网络 API 的隔离 VM 中执行受限数据导出；不导入上游应用逻辑、登录、评论或其他服务。

外层设计采用 Brclio Design System 的暖纸色与品牌蓝（© Brclio，CC BY-NC-SA 4.0）。本目录是摄影模块适配，不是上游全站镜像。
