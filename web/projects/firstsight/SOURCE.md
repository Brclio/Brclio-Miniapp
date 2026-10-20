# FirstSight 摄影来源与素材清单

- 上游：[AndersonHJB/FirstSight](https://github.com/AndersonHJB/FirstSight)
- 固定提交：`6fafcfd4371b00d8c956e58cb5bf689911b5fb2c`
- 原始摄影数据：`data/gallery.ts`、`data/wedding.ts`、`data/family.ts`、`data/baby.ts`、`data/travel.ts`
- 原始类型：`types.ts`
- 来源快照：[`upstream/`](upstream/)，每个文件的 SHA-256 记录在 [`upstream/SNAPSHOT.json`](upstream/SNAPSHOT.json)
- 标准化数据及逐图片可用性清单：[`original-data.json`](original-data.json)
- 导入工具：[`scripts/sync-firstsight.mjs`](../../../../scripts/sync-firstsight.mjs)

本次恢复 FirstSight 已配置的图片地址、照片标题、描述、日期、标签、同一记录中的多张图片，以及婚纱、旅行、成长影像的原有分组。图片下载后保留原始字节，部署至本 Cloudflare 项目的 `/projects/firstsight/assets/original/`，页面无需依赖外部图片站点实时加载。每张图片保留 `originalUrl`、文件 SHA-256、实际尺寸、字节数和 HTTP 状态，便于核对。

摄影数据没有使用此前两张 AI 婚纱素材替换。上游的婚纱及旅行图片生成器使用外部图库地址，旅行分组还包含随机选图；导入时将随机种子固定为 `0x46534947`，使相同来源快照重复生成相同数据。不导入上游模拟 EXIF，不将示例元数据作为经过核实的拍摄信息。

## 导入结果

| 范围 | 分组数 | 展开的图片条目 | 可用条目 |
| --- | ---: | ---: | ---: |
| 摄影画廊 | 1 | 8 | 6 |
| 婚纱系列 | 3 | 19 | 12 |
| 家庭影像 | 1 | 17 | 12 |
| 成长影像 | 3 | 9 | 9 |
| 旅行系列 | 6 | 48 | 44 |
| 合计 | 14 | 101 | 80 |

97 条原始照片记录展开为 101 个图片条目；相同图片在不同记录中出现时保留原分组和记录。44 个不同素材地址中，34 张图片已下载并通过图片格式、实际尺寸、字节数与 SHA-256 核对，共 18,197,609 字节。上游已有的两个 `ai.bornforthis.cn` PNG 也按原始字节保留。

9 个上游图片地址返回 HTTP 404；另有 `/photos/family/IMG_001.jpg` 本地路径示例，但固定提交没有对应文件。它们对应 21 个条目，保留 `originalUrl` 与错误状态，`available: false`、`loadError: true`、`url: ""`，不生成替代图片。若系列封面失效，只选用同系列中已经存在且可用的原图作为后备封面，并记录 `coverFallbackUsed` 与实际来源。

逐地址状态和具体失败原因以 `original-data.json` 的 `assets` 数组为准。4 条视频记录已排除；没有导入信件、随笔、留言或评论服务。

## 重复导入

正常构建只读取已提交的数据和图片，不执行联网同步。

```sh
# 离线重建标准化数据；校验来源快照及已下载文件。
node scripts/sync-firstsight.mjs

# 显式联网重试缺失、失效素材，复用已校验的可用图片。
node scripts/sync-firstsight.mjs --download

# 从固定提交的本地 Git 仓库重取快照；路径可自行指定。
node scripts/sync-firstsight.mjs --source /path/to/FirstSight --download
```

`--source` 只接受上述固定提交，并使用 `git show` 读取提交中的原始文件，不读取尚未提交的工作区修改。导入只打包上述五个数据文件及类型，在不含文件、网络能力的隔离环境中求值。下载最多四个并发，每个请求限时 30 秒、图片上限 20 MiB；仅接受支持且能读取尺寸的图片格式。

现有系列与大图交互分别参考上游 `pages/WeddingPage.tsx` 和 `components/ImmersiveLightbox.tsx`；外层样式沿用 Brclio Design System 的 App 模板基础变量（© Brclio，CC BY-NC-SA 4.0）。本目录是摄影模块适配，不是上游全站镜像。
