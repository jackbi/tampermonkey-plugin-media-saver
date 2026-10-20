# GreasyFork 发布材料

> **已发布**：<https://greasyfork.org/zh-CN/scripts/601145>（脚本 ID 601145，2026-10-20，当前 v0.2.1）
>
> 已开启「源代码同步」（自动模式），源地址是 GitHub raw 的 `dist/media-saver.user.js`；
> 仓库侧已配置 Webhook（`api.greasyfork.org/zh-CN/users/1506196-jackbi/webhook`，push 事件），
> push 到 `main` 且 `@version` 变大后会立即触发同步，不必等定期检查。
> v0.2.1 在安装页挂了 `docs/panel.png` 与 `docs/panel-videos.png` 两张截图。
> 下面的材料留作下次改版或重新上架时参考。

发布地址：<https://greasyfork.org/zh-CN/script_versions/new>
（登录后也可以从右上角用户菜单里点「发布脚本」进入）

上传文件：[`dist/media-saver.user.js`](../dist/media-saver.user.js)

## 表单字段

| 字段 | 值 |
| --- | --- |
| 脚本名称 | 媒体嗅探下载器（微博 / 知乎 / 小红书） |
| 简介（Description） | 嗅探页面真实请求，下载微博 / 知乎 / 小红书的视频与图片，支持 HLS 分片解密、原图还原与批量存图。 |
| 分类 | 影音（Video）或 下载类，按下拉里最接近的一项选 |
| 许可证 | MIT |
| 脚本语言 | 中文（简体） |
| 是否 fork | 否（原创） |

脚本头部已经带 `@name` / `@namespace` / `@version` / `@license MIT` / `@match`，GreasyFork 会自动读取，
不需要在表单里重复填这些。发布后 GreasyFork 会自己补上 `@downloadURL` / `@updateURL`，所以源码里故意没写。

## 详细描述（粘贴到 Additional info）

```markdown
在微博、知乎、小红书上，把网页里**真实播放/显示的**视频和图片抓出来下载。

不依赖页面结构（那些天天变），而是盯着两件事：播放器实际请求的地址（带时效签名的直链、m3u8、分片），
以及各站点的规则（防盗链 Referer、缩略图还原原图、HLS 分片解密）。

## 支持范围

只在下面三个站点启用，其它网站不会加载：

- **微博**（weibo.com / m.weibo.cn）：播放后拿到直链；同一视频的多档清晰度合并成一条，默认最高档；
  缩略图自动还原为 `/large/`；只有 `pic_ids` 的图集也能扫出来
- **知乎**（zhihu.com）：m3u8 流，AES-128 加密的分片在浏览器里解密后合并；
  图片去掉 `/80/`、`_1440w` 等尺寸参数还原原图
- **小红书**（xiaohongshu.com）：直链 mp4 与 fMP4 的 HLS（直接产出 .mp4）；
  图片去掉 `!nd_dft…` 与 `imageView2` 参数拿原图

## 怎么用

1. 打开页面，右下角出现悬浮球（或按 `Alt + S`）；
2. 视频**先播放一次**，再点面板标题栏的 `⟳` 重新扫描（页面内嵌数据里的资源不需要播放）；
3. 勾选后「下载选中」，或直接「下载视频 / 下载图片」批量下载。

每个视频会显示「作者 + 正文片段」和封面，没有封面时鼠标停在那一行会加载首帧，方便认出是哪一个。
大文件会按 8 MB 分块直写磁盘，内存占用与文件大小无关。

## 已知限制

- DRM / SAMPLE-AES 加密的流无法下载，会明确报错而不是产出坏文件；
- 小红书、微博部分视频的水印是服务端烧进画面的，前端去不掉；
- HLS 的 TS 容器只能存成 `.ts`，可用 `ffmpeg -i x.ts -c copy x.mp4` 无损转封装（脚本菜单里有复制命令的功能）；
- 直播流只能下载已生成的片段。

## 源码与反馈

- 源码：https://github.com/jackbi/tampermonkey-plugin-media-saver
- 问题反馈：https://github.com/jackbi/tampermonkey-plugin-media-saver/issues
- 许可证：MIT

> 仅供个人学习与收藏自己有权保存的内容，请遵守各站点的服务条款与著作权规定。
```

## 发布之后：让 GreasyFork 跟着 GitHub 自动更新

在脚本管理页开启 **Script sync**（脚本同步），地址填 GitHub 的 raw 链接：

```
https://raw.githubusercontent.com/jackbi/tampermonkey-plugin-media-saver/main/dist/media-saver.user.js
```

之后每次 push 到 `main`，GreasyFork 会自己拉取新版本；记得先把 `@version` 改大（`npm run bump x.y.z`），
否则它认为没有更新。

## 发布前自查

- [ ] `dist/media-saver.user.js` 是最新构建（`npm run build`），版本号与 `package.json` 一致
- [ ] 代码没有混淆/压缩（GreasyFork 明确禁止混淆代码）
- [ ] 没有 `@require` 外部脚本、没有 `@connect *`（当前都没有）
- [ ] `@match` 只有微博 / 知乎 / 小红书四行
