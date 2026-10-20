// ==UserScript==
// @name         媒体嗅探下载器
// @name:en      Media Saver
// @namespace    tampermonkey-plugin/media-saver
// @version      0.2.0
// @description  嗅探并下载网页里的视频与图片（微博 / 知乎 / 小红书等），支持 HLS(m3u8) 下载、AES-128 解密、原图还原、批量存图
// @description:en  Sniff and download videos/images from web pages, with HLS (m3u8) + AES-128 support and original-image restore.
// @author       wayne
// @license      MIT
// @run-at       document-start
// 只在需要的站点运行；要支持新站点，照抄一行改成对应域名（再在 src/60-sites.js 里加一条规则）
// @match        *://*.weibo.com/*
// @match        *://*.weibo.cn/*
// @match        *://*.zhihu.com/*
// @match        *://*.xiaohongshu.com/*
// 想让它在所有网站生效（不推荐），在 README「扩展到新站点」里看怎么加
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_notification
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @connect      sinaimg.cn
// @connect      weibocdn.com
// @connect      weibo.com
// @connect      weibo.cn
// @connect      zhimg.com
// @connect      zhihu.com
// @connect      vzuu.com
// @connect      xhscdn.com
// @connect      xiaohongshu.com
// @connect      hdslb.com
// @connect      bilivideo.com
// ==/UserScript==
