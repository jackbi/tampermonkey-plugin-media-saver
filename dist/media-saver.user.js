// ==UserScript==
// @name         媒体嗅探下载器
// @name:en      Media Saver
// @namespace    tampermonkey-plugin/media-saver
// @version      0.2.1
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

/*!
 * 由 build.mjs 自动生成，请勿直接修改本文件。
 * 源码在 src/ 目录，改完执行：node build.mjs
 * 版本以 00-header.js 里的 @version 为准。
 */
(function () {
'use strict';

/* ===== 10-core.js ===== */
/* ============================================================
 * 10-core —— 命名空间、配置、事件总线、通用工具
 * ============================================================ */

const MS = {
  VERSION: '0.2.1',
  NAME: '媒体嗅探下载器',
};

/* ---------------------- 常量 ---------------------- */

MS.EXT = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'heic'],
  video: ['mp4', 'm4v', 'mov', 'webm', 'flv', 'mkv', 'avi'],
  audio: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'],
  hls: ['m3u8', 'm3u'],
  dash: ['mpd'],
  segment: ['ts', 'm4s', 'm4f', 'cmfv', 'cmfa'],
};

/** 明显不是媒体资源的域名（统计、埋点、广告） */
MS.BLOCK_HOST_RE = /(google-analytics|googletagmanager|doubleclick|hm\.baidu|bdstatic|sentry\.io|sentry-cdn|umeng|matomo|piwik|hotjar|clarity\.ms|bugsnag|monitor\.|log\.|stat\.|sensorsdata|zhihu-web-analytics|sha\.qq\.com|swork|fonts\.|cdnjs|jsdelivr|unpkg|esm\.sh)/i;

/**
 * 页面内嵌 JSON 里"这条媒体属于哪个作品"的线索字段。
 * 扫描时按对象层级继承，于是深层嵌套的播放地址也能拿到所在微博/笔记的标题与作者。
 */
MS.CONTEXT_KEYS = {
  title: 'title',
  video_title: 'title',
  page_title: 'title',
  text_raw: 'excerpt',
  text: 'excerpt',
  content: 'excerpt',
  desc: 'excerpt',
  description: 'excerpt',
  summary: 'excerpt',
  screen_name: 'author',
  nickname: 'author',
  user_name: 'author',
  author_name: 'author',
  cover: 'cover',
  cover_image_url: 'cover',
  cover_url: 'cover',
  page_pic: 'cover',
  poster: 'cover',
  thumb: 'cover',
  thumbnail: 'cover',
};

/** 这类字段的子对象里通常放着作者信息 */
MS.CONTEXT_NESTED_RE = /^(user|owner|author|author_info|user_info|member|creator|profile)$/i;

/* ---------------------- 配置持久化 ---------------------- */

MS.store = {
  get(key, def) {
    try {
      if (typeof GM_getValue === 'function') {
        const v = GM_getValue(key, undefined);
        return v === undefined ? def : v;
      }
      const raw = localStorage.getItem('ms.' + key);
      return raw == null ? def : JSON.parse(raw);
    } catch (e) {
      return def;
    }
  },
  set(key, val) {
    try {
      if (typeof GM_setValue === 'function') GM_setValue(key, val);
      else localStorage.setItem('ms.' + key, JSON.stringify(val));
    } catch (e) {
      /* 忽略 */
    }
  },
};

MS.DEFAULT_CONF = {
  debug: false,
  /** 站点总开关：未列出的站点只在菜单里手动打开面板 */
  siteEnabled: { weibo: true, zhihu: true, xiaohongshu: true, generic: false },
  /** 大文件直写磁盘（Chrome 的文件系统访问 API），避免整段视频驻留内存 */
  streamToDisk: true,
  /** 分片 / 批量下载并发数 */
  concurrency: 4,
  /** 文件命名模板，支持 {site} {title} {index} {host} {ext} */
  naming: '{site}-{title}-{index}',
  /** 图片自动还原为原图 */
  upgradeImage: true,
  /** 是否在面板里显示头像 / 图标等装饰图 */
  showDecor: false,
  /** SPA 页面地址变化时清空已嗅探列表 */
  clearOnNav: true,
  /** 嗅探到媒体后自动弹出面板 */
  autoOpenPanel: false,
};

MS.conf = Object.assign({}, MS.DEFAULT_CONF, MS.store.get('conf', {}) || {});
MS.conf.siteEnabled = Object.assign({}, MS.DEFAULT_CONF.siteEnabled, MS.conf.siteEnabled || {});
MS.saveConf = () => MS.store.set('conf', MS.conf);

/* ---------------------- 事件总线 ---------------------- */

MS.bus = (() => {
  const handlers = new Map();
  return {
    on(ev, fn) {
      if (!handlers.has(ev)) handlers.set(ev, new Set());
      handlers.get(ev).add(fn);
      return () => handlers.get(ev).delete(fn);
    },
    emit(ev, ...args) {
      const set = handlers.get(ev);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(...args);
        } catch (e) {
          console.error('[MS] 事件处理出错 ' + ev, e);
        }
      }
    },
  };
})();

/* ---------------------- 工具函数 ---------------------- */

MS.util = {
  log(...args) {
    if (MS.conf.debug) console.log('%c[' + MS.NAME + ']', 'color:#2d7ff9;font-weight:bold', ...args);
  },
  warn(...args) {
    console.warn('[' + MS.NAME + ']', ...args);
  },
  sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  },
  debounce(fn, ms = 300) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  },
  fmtBytes(n) {
    if (!n || n < 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return (i === 0 ? String(v) : v.toFixed(v < 10 ? 1 : 0)) + ' ' + units[i];
  },
  fmtDur(sec) {
    if (!sec || sec < 0) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return (h ? h + ':' + pad(m) : String(m)) + ':' + pad(ss);
  },
  pad(n, width = 2) {
    return String(n).padStart(width, '0');
  },
  clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  },
  uniq(arr) {
    return [...new Set(arr)];
  },
  absUrl(url, base) {
    try {
      return new URL(url, base || location.href).href;
    } catch (e) {
      return '';
    }
  },
  isHttpUrl(u) {
    return /^https?:\/\//i.test(u || '');
  },
  hostOf(u) {
    try {
      return new URL(u).hostname;
    } catch (e) {
      return '';
    }
  },
  extOf(u) {
    try {
      const p = new URL(u, location.href).pathname;
      const m = /\.([a-z0-9]{1,6})$/i.exec(p);
      return m ? m[1].toLowerCase() : '';
    } catch (e) {
      return '';
    }
  },
  baseName(u) {
    try {
      const p = new URL(u, location.href).pathname;
      const seg = p.split('/').filter(Boolean).pop() || '';
      return decodeURIComponent(seg).replace(/\.[a-z0-9]{1,6}$/i, '');
    } catch (e) {
      return '';
    }
  },
  /** 去掉 Windows / macOS 非法字符，并限制长度 */
  sanitize(name, max = 72) {
    const s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[.\s]+|[.\s]+$/g, '')
      .slice(0, max)
      .trim();
    return s || 'untitled';
  },
  /** 清理从页面数据里抠出来的文本：去标签、还原常见实体、压缩空白 */
  cleanText(str, max = 60) {
    let t = String(str == null ? '' : str);
    if (/[<&]/.test(t)) {
      t = t
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");
    }
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  },
  /** 深度遍历对象里的所有字符串（自动跳过环与超大结构） */
  deepWalk(root, cb, opts = {}) {
    const maxNodes = opts.maxNodes || 300000;
    const maxDepth = opts.maxDepth || 12;
    const seen = new WeakSet();
    const stack = [[root, [], '', 0, null]];
    let count = 0;
    while (stack.length) {
      const [node, path, key, depth, ctx] = stack.pop();
      if (++count > maxNodes) break;
      if (node == null) continue;
      const type = typeof node;
      if (type === 'string') {
        cb(node, path, key, ctx);
        continue;
      }
      if (type !== 'object' || depth > maxDepth) continue;
      if (seen.has(node)) continue;
      seen.add(node);

      const isArray = Array.isArray(node);
      let childCtx = ctx;
      if (!isArray) {
        // 先看本层自己的字段再往下走，子节点就能继承"这是哪条微博"的上下文
        childCtx = Object.create(ctx || null);
        for (const k of Object.keys(node)) {
          const v = node[k];
          const field = MS.CONTEXT_KEYS[k.toLowerCase()];
          if (field && typeof v === 'string' && !childCtx[field]) {
            childCtx[field] = v;
          } else if (!field && v && typeof v === 'object' && !Array.isArray(v) && MS.CONTEXT_NESTED_RE.test(k)) {
            for (const ak of ['screen_name', 'nickname', 'user_name', 'name']) {
              if (!childCtx.author && typeof v[ak] === 'string') childCtx.author = v[ak];
            }
          }
        }
      }

      if (isArray) {
        for (let i = node.length - 1; i >= 0; i--) stack.push([node[i], path.concat(key), String(i), depth + 1, ctx]);
      } else {
        for (const k of Object.keys(node)) stack.push([node[k], path.concat(key), k, depth + 1, childCtx]);
      }
    }
  },
  /** 有限并发地跑一组任务 */
  async pool(items, limit, worker) {
    const list = [...items];
    const size = MS.util.clamp(limit || 1, 1, 16);
    let cursor = 0;
    const run = async () => {
      while (cursor < list.length) {
        const index = cursor++;
        await worker(list[index], index);
      }
    };
    await Promise.all(Array.from({ length: Math.min(size, list.length) }, run));
  },
};

/* ---------------------- DOM 小工具 ---------------------- */

MS.dom = {
  /** h('div.ms-row#x', {title:'t'}, child, ...) */
  h(sel, attrs, ...kids) {
    const parts = String(sel || 'div').split(/(?=[.#])/);
    const el = document.createElement(parts[0] || 'div');
    for (let i = 1; i < parts.length; i++) {
      const t = parts[i];
      if (t[0] === '#') el.id = t.slice(1);
      else if (t[0] === '.') el.classList.add(t.slice(1));
    }
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      kids.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat(9)) {
      if (kid == null || kid === false || kid === '') continue;
      el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return el;
  },
  qs(sel, root) {
    try {
      return (root || document).querySelector(sel);
    } catch (e) {
      return null;
    }
  },
  qsa(sel, root) {
    try {
      return [...(root || document).querySelectorAll(sel)];
    } catch (e) {
      return [];
    }
  },
};

/** 页面真实 window（绕过 Tampermonkey 沙箱） */
MS.page = (() => {
  try {
    return typeof unsafeWindow !== 'undefined' && unsafeWindow ? unsafeWindow : window;
  } catch (e) {
    return window;
  }
})();

/* ===== 20-net.js ===== */
/* ============================================================
 * 20-net —— GM 网络请求封装 + 媒体嗅探引擎
 * ============================================================ */

/** 已知的媒体 CDN 特征（用于 URL 无扩展名时也能识别） */
MS.MEDIA_HOST_RE = /(sinaimg\.cn|weibocdn\.com|video\.weibo|zhimg\.com|vzuu\.com|xhscdn\.com|ci\.xiaohongshu|douyinpic|douyinvod|hdslb\.com|bilivideo|pstatp|byteimg|ixigua|twimg\.com|cdninstagram|fbcdn|ytimg|ggpht)/i;

/** 运行时状态（mse = 站点用 MediaSource 流式喂数据，拿不到完整文件） */
MS.state = { mse: false };

/* ---------------------- 统一网络层 ---------------------- */

MS.net = {
  gm: typeof GM_xmlhttpRequest === 'function',
  /** 我们自己发起的请求不要去嗅探（页面内 fetch 回退时用得到） */
  ignoreNext: new Set(),

  /**
   * 统一请求入口。所有网络访问都走这里，方便在 Node 里做端到端测试。
   * @returns {Promise<{status:number, headers:Object, header:(n:string)=>string, response:any, finalUrl:string}>}
   */
  request(opts = {}) {
    const {
      url,
      method = 'GET',
      referer,
      data = undefined,
      responseType = 'text',
      timeout = 60000,
      onprogress,
      anonymous = false,
    } = opts;
    // referer 简写：部分站点的 CDN 有防盗链，必须带 Referer
    const headers = Object.assign({}, referer ? { Referer: referer } : {}, opts.headers || {});

    if (this.gm && !opts.forcePage) {
      return new Promise((resolve, reject) => {
        const req = {
          method,
          url,
          headers,
          data,
          timeout,
          anonymous,
          responseType,
          onload: (res) => {
            const norm = MS.net._norm(res);
            // 401/403/451 多见于 CDN 校验 Referer，标记后交给页面内 fetch 重试
            if (!opts.noPageFallback && [401, 403, 451].includes(norm.status)) {
              reject(Object.assign(new Error('HTTP ' + norm.status), { retryViaPage: true }));
              return;
            }
            resolve(norm);
          },
          onerror: (e) =>
            reject(Object.assign(new Error('请求失败：' + url + ' ' + ((e && e.error) || '')), { retryViaPage: true })),
          ontimeout: () => reject(new Error('请求超时：' + url)),
          onabort: () => reject(new Error('请求已取消')),
        };
        if (onprogress) {
          req.onprogress = (e) => {
            try {
              onprogress(e);
            } catch (err) {
              /* 忽略 */
            }
          };
        }
        try {
          GM_xmlhttpRequest(req);
        } catch (e) {
          reject(e);
        }
      }).catch((err) => {
        // GM_xmlhttpRequest 由扩展发起，Referer 未必改得动；页面内 fetch 会自然带上本站 Referer 与 Cookie，
        // 对小红书这类强防盗链的 CDN 往往是唯一可行的路径
        if (!err.retryViaPage || opts.noPageFallback) throw err;
        MS.util.log('GM 请求被拒，改用页面内 fetch 重试：', url, err.message);
        return this.request(Object.assign({}, opts, { forcePage: true, noPageFallback: true }));
      });
    }

    // 回退：页面内 fetch（受 CORS 限制，仅在同源或 CDN 放行时可用）
    this.ignoreNext.add(url);
    return fetch(url, { method, headers, body: data, credentials: 'include' })
      .then(async (res) => {
        const buf = responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
        const headersObj = {};
        res.headers.forEach((v, k) => {
          headersObj[k.toLowerCase()] = v;
        });
        return {
          status: res.status,
          headers: headersObj,
          header: (n) => res.headers.get(n) || '',
          response: buf,
          finalUrl: res.url || url,
        };
      })
      .catch((e) => {
        throw new Error('请求失败（页面内 fetch 受同源策略限制）：' + url + ' ' + e.message);
      });
  },

  _norm(res) {
    const headers = {};
    const raw = res.responseHeaders || '';
    for (const line of String(raw).split(/\r?\n/)) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    }
    return {
      status: res.status,
      headers,
      header: (n) => headers[String(n).toLowerCase()] || '',
      response: res.response,
      finalUrl: res.finalUrl || res.responseURL || '',
    };
  },

  async text(url, opts = {}) {
    const res = await this.request(Object.assign({ url, responseType: 'text' }, opts));
    if (res.status >= 400) throw new Error('HTTP ' + res.status + '：' + url);
    return res.response;
  },

  async buffer(url, opts = {}) {
    const res = await this.request(Object.assign({ url, responseType: 'arraybuffer' }, opts));
    if (res.status >= 400) throw new Error('HTTP ' + res.status + '：' + url);
    return res.response;
  },

  /** 探测资源的 content-type 与体积；很多 CDN 禁 HEAD，故用 Range 回退 */
  async probe(url, opts = {}) {
    const referer = opts.referer;
    const out = { url, status: 0, contentType: '', size: 0 };
    const apply = (res) => {
      out.status = res.status;
      out.contentType = (res.header('content-type') || '').split(';')[0].trim().toLowerCase();
      let len = Number(res.header('content-length')) || 0;
      const cr = res.header('content-range') || '';
      const m = /\/(\d+)\s*$/.exec(cr);
      if (m) len = Number(m[1]) || len;
      out.size = len;
    };

    try {
      const res = await this.request({
        url,
        method: 'HEAD',
        headers: referer ? { Referer: referer } : {},
        timeout: 6000,
      });
      if (res.status >= 200 && res.status < 300) {
        apply(res);
        if (out.contentType || out.size) return out;
      }
    } catch (e) {
      /* 继续回退 */
    }

    try {
      const res = await this.request({
        url,
        headers: Object.assign({ Range: 'bytes=0-0' }, referer ? { Referer: referer } : {}),
        timeout: 8000,
        responseType: 'arraybuffer',
      });
      apply(res);
      if (res.status !== 206) out.size = out.size || 0;
    } catch (e) {
      /* 探测失败不影响后续下载 */
    }
    return out;
  },
};

/* ---------------------- 嗅探引擎 ---------------------- */

MS.sniffer = {
  /** key -> item */
  items: new Map(),
  seq: 0,
  started: false,

  /** 由站点规则决定的"哪些地址算媒体" */
  accept(url, contentType) {
    if (!url || !MS.util.isHttpUrl(url)) return false;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch (e) {
      return false;
    }
    if (MS.BLOCK_HOST_RE.test(host)) return false;

    const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
    const ext = MS.util.extOf(url);

    if (ct) {
      if (ct.startsWith('image/')) return ct !== 'image/svg+xml';
      if (ct.startsWith('video/') || ct.startsWith('audio/')) return true;
      if (ct === 'application/vnd.apple.mpegurl' || ct === 'application/x-mpegurl' || ct === 'audio/mpegurl') return true;
      if (ct === 'application/dash+xml') return true;
      // 明确的非媒体类型，避免把 .jpg 结尾的 HTML 当成图片
      if (ct.startsWith('text/') || ct.includes('javascript') || ct.includes('json') || ct.includes('css') || ct.includes('html')) {
        return false;
      }
    }

    const all = [].concat(MS.EXT.image, MS.EXT.video, MS.EXT.audio, MS.EXT.hls, MS.EXT.dash, MS.EXT.segment);
    if (ext && all.includes(ext)) return true;
    if (MS.MEDIA_HOST_RE.test(host)) return true;
    return false;
  },

  /** 判断"主内容"还是"装饰图"（头像、图标），面板默认只显示主内容 */
  relevanceOf(url, hint) {
    const site = MS.sites.current;
    if (hint === 'decor' || hint === 'content') return hint;
    if (site && site.decorRe && site.decorRe.test(url)) return 'decor';
    if (site && site.contentHostRe && site.contentHostRe.test(url)) return 'content';
    if (/(avatar|headimg|portrait|icon|logo|emoji|sprite|thumb_?small|face)/i.test(url)) return 'decor';
    return 'unknown';
  },

  /**
   * 登记一个候选地址
   * @param {string} rawUrl
   * @param {{source?:string, contentType?:string, size?:number, hint?:string, order?:number,
   *          title?:string, author?:string, poster?:string}} meta
   */
  add(rawUrl, meta = {}) {
    if (!rawUrl) return null;
    let url = String(rawUrl).trim();
    if (url.startsWith('//')) url = location.protocol + url;
    if (!MS.util.isHttpUrl(url)) return null;
    url = url.replace(/#.*$/, '');
    if (MS.net.ignoreNext.has(url)) {
      MS.net.ignoreNext.delete(url);
      return null;
    }
    if (!this.accept(url, meta.contentType)) return null;

    const kind = MS.media.kindOf(url, meta.contentType);
    // 图片按"原图"归并，同一个图的不同尺寸只留一条
    const originUrl = kind === 'image' ? MS.sites.upgradeImage(url) : url;
    const key = kind === 'image' ? originUrl : url;
    const exist = this.items.get(key);
    if (exist) {
      if (meta.contentType && !exist.contentType) exist.contentType = meta.contentType;
      if (meta.size && !exist.size) exist.size = meta.size;
      if (meta.hint === 'content' && exist.relevance !== 'content') exist.relevance = 'content';
      // 后续扫描到的上下文用来补全早先只看到地址的记录
      if (!exist.title && meta.title) exist.title = MS.util.cleanText(meta.title, 80);
      if (!exist.author && meta.author) exist.author = MS.util.cleanText(meta.author, 24);
      if (!exist.poster && meta.poster) exist.poster = meta.poster;
      if (exist.order == null && meta.order != null) exist.order = meta.order;
      return exist;
    }

    const item = {
      id: ++this.seq,
      key,
      url,
      originUrl: originUrl !== url ? originUrl : '',
      kind,
      ext: MS.util.extOf(originUrl) || MS.util.extOf(url),
      host: MS.util.hostOf(url),
      source: meta.source || 'unknown',
      contentType: meta.contentType || '',
      size: meta.size || 0,
      relevance: this.relevanceOf(url, meta.hint),
      title: meta.title ? MS.util.cleanText(meta.title, 80) : '',
      author: meta.author ? MS.util.cleanText(meta.author, 24) : '',
      poster: meta.poster || '',
      order: meta.order == null ? null : meta.order,
      probed: false,
      t: Date.now(),
      useOrigin: MS.conf.upgradeImage,
    };
    if (item.poster && !MS.util.isHttpUrl(item.poster)) item.poster = MS.util.absUrl(item.poster);
    this.items.set(key, item);
    MS.util.log('嗅探到', kind, url, meta.source);
    MS.bus.emit('media', item);
    return item;
  },

  /** 当前实际参与下载的地址 */
  effectiveUrl(item) {
    if (item.chosen) return item.chosen;
    if (item.kind === 'image' && item.originUrl && item.useOrigin) return item.originUrl;
    return item.url;
  },

  byId(id) {
    const num = Number(id);
    for (const item of this.items.values()) {
      if (item.id === num) return item;
    }
    return null;
  },

  list(filter = {}) {
    let arr = [...this.items.values()];
    if (!filter.decor) arr = arr.filter((it) => it.relevance !== 'decor');
    if (filter.kind) arr = arr.filter((it) => filter.kind === 'video' ? it.kind === 'video' || it.kind === 'hls' || it.kind === 'segment' : it.kind === filter.kind);
    // 同类型内尽量贴合页面顺序：有页面顺序的排前面，只嗅探到地址的按发现时间排
    const rank = (it) => ['image', 'video', 'hls', 'dash', 'segment', 'audio', 'unknown'].indexOf(it.kind);
    return arr.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.order == null ? 1 : 0) - (b.order == null ? 1 : 0) ||
        (a.order == null ? a.id : a.order) - (b.order == null ? b.id : b.order)
    );
  },

  remove(id) {
    for (const [k, v] of this.items) {
      if (v.id === id) this.items.delete(k);
    }
  },

  clear() {
    this.items.clear();
    MS.bus.emit('reset');
  },

  /* ---------------- 启动各类钩子 ---------------- */

  start() {
    if (this.started) return;
    this.started = true;
    this._hookPerf();
    this._hookXhr();
    this._hookFetch();
    this._hookBlob();
  },

  /** 1) 资源时间线：最可靠，页面加载的任何资源都会出现在这里 */
  _hookPerf() {
    const push = (entries) => {
      for (const e of entries || []) {
        try {
          this.add(e.name, { source: 'net:' + (e.initiatorType || 'other'), size: e.transferSize || 0 });
        } catch (err) {
          /* 忽略 */
        }
      }
    };
    try {
      push(performance.getEntriesByType('resource'));
    } catch (e) {
      /* 忽略 */
    }
    try {
      const po = new PerformanceObserver((list) => push(list.getEntries()));
      po.observe({ type: 'resource', buffered: true });
    } catch (e) {
      MS.util.warn('PerformanceObserver 不可用，将只依赖 XHR/fetch 钩子', e);
    }
  },

  /** 2) XHR：能顺便拿到 content-type，用于识别无扩展名的 CDN 地址 */
  _hookXhr() {
    const XHRClass = MS.page.XMLHttpRequest;
    if (!XHRClass || !XHRClass.prototype) return;
    const proto = XHRClass.prototype;
    const origOpen = proto.open;
    const origSend = proto.send;
    if (!origOpen || !origSend) return;

    proto.open = function (method, url, ...rest) {
      try {
        this.__ms_url = MS.util.absUrl(url);
      } catch (e) {
        /* 忽略 */
      }
      return origOpen.call(this, method, url, ...rest);
    };

    proto.send = function (...args) {
      try {
        const url = this.__ms_url;
        if (url) {
          const capture = () => {
            let ct = '';
            let len = 0;
            try {
              ct = this.getResponseHeader('content-type') || '';
            } catch (e) {
              /* 忽略 */
            }
            try {
              len = Number(this.getResponseHeader('content-length')) || 0;
            } catch (e) {
              /* 忽略 */
            }
            const finalUrl = this.responseURL || url;
            MS.sniffer.add(finalUrl, { source: 'xhr', contentType: ct, size: len });
            if (finalUrl !== url) MS.sniffer.add(url, { source: 'xhr', contentType: ct, size: len });
          };
          if (this.__ms_done) capture();
          else this.addEventListener('load', capture, { once: true });
        }
      } catch (e) {
        /* 忽略 */
      }
      return origSend.apply(this, args);
    };
  },

  /** 3) fetch：同上，读响应头即可，不消费 body */
  _hookFetch() {
    const target = MS.page;
    const orig = target.fetch;
    if (typeof orig !== 'function') return;
    target.fetch = function (input, init) {
      let url = '';
      try {
        url = MS.util.absUrl(typeof input === 'string' ? input : (input && input.url) || '');
      } catch (e) {
        /* 忽略 */
      }
      const promise = orig.apply(this, arguments);
      if (!url || !promise || typeof promise.then !== 'function') return promise;
      return promise.then((res) => {
        try {
          const ct = res.headers.get('content-type') || '';
          const len = Number(res.headers.get('content-length')) || 0;
          MS.sniffer.add(res.url || url, { source: 'fetch', contentType: ct, size: len });
        } catch (e) {
          /* 忽略 */
        }
        return res;
      });
    };
  },

  /** 4) 识别 MSE 流式播放（分片喂给 MediaSource，控制台无法直接拿到完整文件） */
  _hookBlob() {
    try {
      const URLClass = MS.page.URL;
      if (!URLClass) return;
      const orig = URLClass.createObjectURL;
      if (typeof orig !== 'function') return;
      URLClass.createObjectURL = function (obj) {
        try {
          if (typeof MediaSource !== 'undefined' && obj instanceof MediaSource) MS.state.mse = true;
        } catch (e) {
          /* 忽略 */
        }
        return orig.call(this, obj);
      };
    } catch (e) {
      /* 忽略 */
    }
  },
};

/* ===== 30-classify.js ===== */
/* ============================================================
 * 30-classify —— 媒体类型判定与体积探测
 * ============================================================ */

MS.media = {
  /** @returns {'image'|'video'|'audio'|'hls'|'dash'|'segment'|'unknown'} */
  kindOf(url, contentType) {
    const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
    const ext = MS.util.extOf(url);

    if (ct) {
      if (ct === 'application/vnd.apple.mpegurl' || ct === 'application/x-mpegurl' || ct === 'audio/mpegurl' || ct === 'audio/x-mpegurl') return 'hls';
      if (ct === 'application/dash+xml') return 'dash';
      if (ct === 'video/mp2t' || ct === 'video/iso.segment') return 'segment';
      if (ct.startsWith('image/')) return 'image';
      if (ct.startsWith('video/')) return 'video';
      if (ct.startsWith('audio/')) return 'audio';
    }

    if (MS.EXT.hls.includes(ext)) return 'hls';
    if (MS.EXT.dash.includes(ext)) return 'dash';
    if (MS.EXT.segment.includes(ext)) return 'segment';
    if (MS.EXT.image.includes(ext)) return 'image';
    if (MS.EXT.video.includes(ext)) return 'video';
    if (MS.EXT.audio.includes(ext)) return 'audio';

    const host = MS.util.hostOf(url);
    if (/sns-video|xhscdn\.com\/stream|weibocdn|vzuu\.com|bilivideo|douyinvod/i.test(url)) return 'video';
    if (MS.sites.current && MS.sites.current.imageHostRe && MS.sites.current.imageHostRe.test(host)) return 'image';
    if (MS.MEDIA_HOST_RE.test(host)) return 'unknown';
    return 'unknown';
  },

  kindLabel(kind) {
    return {
      image: '图片',
      video: '视频',
      audio: '音频',
      hls: 'HLS 流',
      dash: 'DASH',
      segment: '分片',
      unknown: '未知',
    }[kind] || kind;
  },

  /** 单个资源的类型 + 体积探测（带并发控制） */
  async probe(item) {
    if (item.probed || item.probing) return item;
    item.probing = true;
    try {
      const res = await MS.net.probe(MS.sniffer.effectiveUrl(item), { referer: MS.sites.referer() });
      if (res.contentType) item.contentType = res.contentType;
      if (res.size) item.size = res.size;
      const kind = this.kindOf(item.url, res.contentType);
      if (kind !== 'unknown') item.kind = kind;
      item.probed = true;
    } catch (e) {
      item.probeError = e.message;
    } finally {
      item.probing = false;
    }
    MS.bus.emit('probe', item);
    return item;
  },

  /** 面板打开时批量补全信息（体积 / 精确类型） */
  probing: false,
  async probePending(items) {
    if (this.probing) return;
    this.probing = true;
    try {
      const todo = items.filter((it) => !it.probed && !it.probing).slice(0, 16);
      await MS.util.pool(todo, 4, (it) => this.probe(it));
    } finally {
      this.probing = false;
    }
  },

  /**
   * 把散落的 ts/m4s 分片按目录聚合成"可合并的视频"
   * 用于站点把 m3u8 藏在播放器内部、只暴露分片请求的情况
   */
  groupSegments(items) {
    const groups = new Map();
    for (const it of items) {
      if (it.kind !== 'segment') continue;
      const url = it.url;
      let dir = '';
      try {
        dir = new URL(url).pathname.replace(/[^/]*$/, '');
      } catch (e) {
        continue;
      }
      const key = MS.util.hostOf(url) + dir;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    return [...groups.entries()]
      .filter(([, list]) => list.length >= 2)
      .map(([key, list]) => ({ dir: key, items: list.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true })) }))
      .sort((a, b) => b.items.length - a.items.length);
  },
};

/* ===== 40-download.js ===== */
/* ============================================================
 * 40-download —— 文件落盘、进度、批量下载
 * ============================================================ */

/* ---------------------- 磁盘直写（Chrome 文件系统访问 API） ---------------------- */

const MIME_BY_EXT = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ts: 'video/mp2t',
  m4s: 'video/mp4',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

MS.fs = {
  get supported() {
    try {
      return typeof MS.page.showSaveFilePicker === 'function' && typeof MS.page.showDirectoryPicker === 'function';
    } catch (e) {
      return false;
    }
  },

  /** 注意：必须在用户点击的同步调用栈里调用，否则浏览器会拒绝 */
  pickFile(name, ext) {
    const mime = MIME_BY_EXT[(ext || '').toLowerCase()];
    const opts = { suggestedName: name, id: 'ms-file' };
    if (mime) {
      opts.types = [{ description: '媒体文件', accept: { [mime]: ['.' + ext] } }];
    }
    return MS.page.showSaveFilePicker(opts);
  },

  pickDir() {
    return MS.page.showDirectoryPicker({ id: 'ms-dir', mode: 'readwrite' });
  },

  /** 返回统一的写入器：{ write(chunk), close(), name } */
  async writerFromFile(handle, name) {
    const stream = await handle.createWritable();
    return {
      streamed: true,
      name,
      write: (chunk) => stream.write(chunk),
      close: async () => {
        await stream.close();
      },
    };
  },

  async writerFromDir(dir, name) {
    const handle = await dir.getFileHandle(name, { create: true });
    return this.writerFromFile(handle, name);
  },
};

/* ---------------------- 下载器 ---------------------- */

MS.dl = {
  tasks: new Map(),
  taskSeq: 0,
  /** 直写磁盘时每段的字节数（测试里会调小以覆盖多段拼接） */
  chunkSize: 8 * 1024 * 1024,

  /** 文件名模板渲染 */
  fileName(item, index, opts = {}) {
    const site = MS.sites.current;
    const fallbackExt = { image: 'jpg', video: 'mp4', audio: 'mp3', hls: 'ts', dash: 'mp4', segment: 'ts' };
    // 播放列表后缀（m3u8/mpd）不是媒体文件后缀，需要换成真实容器
    const playlistExt = { m3u8: fallbackExt[item.kind] || 'ts', m3u: fallbackExt[item.kind] || 'ts', mpd: 'mp4' };
    let raw = String(opts.ext || item.ext || fallbackExt[item.kind] || 'bin').toLowerCase();
    let ext = playlistExt[raw] || raw;
    if (!/^[a-z0-9]{1,5}$/.test(ext)) ext = fallbackExt[item.kind] || 'bin';
    const vars = {
      site: site ? site.name : MS.util.hostOf(location.href),
      title: MS.sites.title(),
      index: MS.util.pad(index, 2),
      host: item.host,
      ext,
    };
    const name = String(MS.conf.naming || '{site}-{title}-{index}').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return MS.util.sanitize(name, 84) + '.' + ext;
  },

  newTask(name) {
    const task = { id: ++this.taskSeq, name, loaded: 0, total: 0, status: 'running', error: '', phase: '准备中' };
    this.tasks.set(task.id, task);
    MS.bus.emit('task', task);
    return task;
  },

  updateTask(task, patch) {
    Object.assign(task, patch);
    MS.bus.emit('task', task);
  },

  /* ---------- 单文件下载 ---------- */

  /**
   * 单个资源（图片 / 直链视频）
   * 有 sink 时优先按 Range 分块直写磁盘，避免整段文件驻留内存
   */
  async single(url, ctx) {
    const { referer, sink, task } = ctx;
    const emit = (loaded, total) => {
      if (task) this.updateTask(task, { loaded, total: total || task.total, phase: total ? Math.round((loaded / total) * 100) + '%' : MS.util.fmtBytes(loaded) });
    };

    if (sink) {
      const info = await MS.net.probe(url, { referer });
      const total = info.size;
      if (total > 0) {
        const chunkSize = this.chunkSize;
        let offset = 0;
        while (offset < total) {
          const end = Math.min(offset + chunkSize, total) - 1;
          let attempt = 0;
          let buf = null;
          let whole = false;
          while (attempt < 3 && !buf) {
            attempt++;
            try {
              const res = await MS.net.request({
                url,
                headers: Object.assign({ Range: 'bytes=' + offset + '-' + end }, referer ? { Referer: referer } : {}),
                responseType: 'arraybuffer',
                timeout: 120000,
                onprogress: (e) => {
                  if (e && e.total) emit(offset + (e.loaded || 0), total);
                },
              });
              if (res.status === 200) {
                // 服务端忽略 Range，直接给了整段
                buf = res.response;
                whole = true;
              } else if (res.status === 206) {
                buf = res.response;
              } else {
                throw new Error('HTTP ' + res.status);
              }
            } catch (e) {
              if (attempt >= 3) throw new Error('下载中断（第 ' + offset + ' 字节处）：' + e.message);
              await MS.util.sleep(600 * attempt);
            }
          }
          await sink.write(buf);
          offset += whole ? total - offset : buf.byteLength;
          emit(Math.min(offset, total), total);
          if (whole) break;
        }
        return { bytes: offset };
      }
      MS.util.log('体积未知，退回内存模式', url);
    }

    const buf = await MS.net.buffer(url, {
      referer,
      timeout: 15 * 60 * 1000,
      onprogress: (e) => {
        if (e && e.total) emit(e.loaded || 0, e.total);
      },
    });
    emit(buf.byteLength, buf.byteLength);
    // 已经申请到磁盘句柄时别浪费：整段写进去，避免在磁盘上留下一个空文件
    if (sink) {
      await sink.write(buf);
      return { bytes: buf.byteLength };
    }
    const blob = new Blob([buf], { type: ctx.mime || MIME_BY_EXT[ctx.ext] || '' });
    await this.saveBlob(blob, ctx.name);
    return { bytes: buf.byteLength };
  },

  /** 合并嗅探到的分片（站内没有暴露 m3u8 时的兜底方案） */
  async mergeSegments(group, ctx) {
    const items = group.items;
    const dir = items[0].url.replace(/[^/]*$/, '');
    const isFmp4 = items.every((it) => /\.(m4s|m4f)$/i.test(it.url));
    // fMP4 需要一个 init 段拼在最前面
    const initItem = isFmp4
      ? MS.sniffer.list({ decor: true }).find((it) => it.url.startsWith(dir) && /init|header/i.test(it.url))
      : null;
    const list = initItem ? [initItem, ...items] : items;
    const total = list.length;
    let done = 0;

    if (ctx.task) this.updateTask(ctx.task, { total, phase: '0/' + total });
    for (const it of list) {
      let buf = null;
      for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
        try {
          buf = await MS.net.buffer(it.url, { referer: ctx.referer, timeout: 120000 });
        } catch (e) {
          if (attempt >= 3) throw new Error('分片下载失败：' + it.url + ' ' + e.message);
          await MS.util.sleep(500 * attempt);
        }
      }
      if (ctx.sink) await ctx.sink.write(buf);
      else ctx.parts.push(buf);
      done++;
      if (ctx.task) {
        this.updateTask(ctx.task, {
          total,
          loaded: done,
          phase: done + '/' + total,
          bytes: (ctx.task.bytes || 0) + buf.byteLength,
        });
      }
    }
    if (!ctx.sink) {
      const blob = new Blob(ctx.parts, { type: isFmp4 ? 'video/mp4' : 'video/mp2t' });
      await this.saveBlob(blob, ctx.name);
    }
    return { bytes: ctx.task ? ctx.task.bytes || 0 : 0 };
  },

  /* ---------- 落盘 ---------- */

  async saveBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).append(a);
    a.click();
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 60000);
  },

  /** 兜底方案：交给 Tampermonkey 的下载器，或直接新建标签页 */
  async fallbackUrl(url, name, referer) {
    if (typeof GM_download === 'function') {
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err) => {
          if (settled) return;
          settled = true;
          if (err) reject(new Error(err));
          else resolve();
        };
        try {
          GM_download({
            url,
            name,
            headers: referer ? { Referer: referer } : undefined,
            timeout: 30 * 60 * 1000,
            onload: () => finish(),
            onerror: (e) => finish('下载失败：' + ((e && e.error) || '未知错误')),
            ontimeout: () => finish('下载超时'),
          });
        } catch (e) {
          finish(e.message);
        }
      });
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.target = '_blank';
    a.rel = 'noopener';
    a.style.display = 'none';
    (document.body || document.documentElement).append(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
  },

  copyText(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return true;
      }
    } catch (e) {
      /* 继续 */
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch (e) {
      return false;
    }
  },

  /* ---------- 批量下载 ---------- */

  /**
   * 同步阶段：必须在点击手势里调用，用来申请磁盘写入权限
   * 返回 { mode:'none'|'file'|'dir', promise }
   */
  prepareSink(items) {
    const plan = { mode: 'none', promise: null };
    if (!MS.conf.streamToDisk || !MS.fs.supported) return plan;
    const heavy = items.some((it) => ['video', 'hls', 'segment', 'dash'].includes(it.kind));
    if (!heavy) return plan;
    try {
      const single = items[0];
      // HLS 的真实容器要解析播放列表后才知道，因此统一用"选文件夹"的方式
      if (items.length > 1 || single.kind === 'hls' || single.kind === 'dash' || single.kind === 'segment') {
        plan.mode = 'dir';
        plan.promise = MS.fs.pickDir();
      } else {
        plan.mode = 'file';
        plan.promise = MS.fs.pickFile(this.fileName(single, 1), single.ext || 'mp4');
      }
    } catch (e) {
      MS.util.warn('无法申请磁盘写入权限，改用内存模式', e);
      return { mode: 'none', promise: null };
    }
    return plan;
  },

  async resolveSink(plan) {
    if (!plan || plan.mode === 'none' || !plan.promise) return { mode: 'none' };
    try {
      const handle = await plan.promise;
      return { mode: plan.mode, handle };
    } catch (e) {
      if (e && e.name === 'AbortError') return { mode: 'none', cancelled: true };
      MS.util.warn('磁盘直写不可用，改用内存模式', e);
      return { mode: 'none' };
    }
  },

  /**
   * 下载一组条目
   * @param {object[]} items
   * @param {{plan?:object, index0?:number}} opts
   */
  async run(items, opts = {}) {
    const plan = await this.resolveSink(opts.plan);
    const referer = MS.sites.referer();
    const results = [];
    const images = items.filter((it) => it.kind === 'image');
    const rest = items.filter((it) => it.kind !== 'image');

    const download = async (item, index) => {
      const task = this.newTask(this.fileName(item, index + 1));
      const ctx = { referer, name: task.name, task, parts: [], mime: '', ext: item.ext };
      try {
        // HLS 要先解析播放列表，才知道真实容器是 .ts 还是 .mp4
        let prepared = null;
        if (item.kind === 'hls') {
          prepared = await MS.hls.prepare(MS.sniffer.effectiveUrl(item), { referer, variant: item.variant });
          ctx.name = this.fileName(item, index + 1, { ext: prepared.ext });
          this.updateTask(task, { name: ctx.name });
        }
        if (plan.mode === 'file') {
          ctx.sink = await MS.fs.writerFromFile(plan.handle, ctx.name);
        } else if (plan.mode === 'dir') {
          ctx.sink = await MS.fs.writerFromDir(plan.handle, ctx.name);
        }

        let bytes = 0;
        if (item.kind === 'hls') {
          const res = await MS.hls.fetchAll(prepared, ctx);
          bytes = res.bytes;
        } else if (item.kind === 'segment' && item.segmentGroup) {
          const res = await this.mergeSegments(item.segmentGroup, ctx);
          bytes = res.bytes;
        } else if (item.kind === 'dash') {
          throw new Error('DASH（.mpd）暂不支持，请改用嗅探到的分片或直链');
        } else {
          ctx.mime = item.contentType || '';
          const res = await this.single(MS.sniffer.effectiveUrl(item), ctx);
          bytes = res.bytes;
        }
        if (ctx.sink) await ctx.sink.close();
        this.updateTask(task, { status: 'done', phase: '完成', loaded: bytes, total: bytes || task.total });
        results.push({ item, name: ctx.name, ok: true, bytes });
      } catch (e) {
        MS.util.warn('下载失败', item.url, e);
        try {
          if (ctx.sink && ctx.sink.close) await ctx.sink.close();
        } catch (err) {
          /* 忽略 */
        }
        // 内存模式失败时，尝试交给浏览器/下载器直接取
        if (!ctx.sink && item.kind !== 'hls' && item.kind !== 'segment') {
          try {
            await this.fallbackUrl(MS.sniffer.effectiveUrl(item), ctx.name, referer);
            this.updateTask(task, { status: 'done', phase: '已交给浏览器下载' });
            results.push({ item, name: ctx.name, ok: true, viaFallback: true });
            return;
          } catch (err) {
            /* 继续走失败 */
          }
        }
        this.updateTask(task, { status: 'error', error: e.message, phase: '失败' });
        results.push({ item, name: ctx.name, ok: false, error: e.message });
      }
    };

    // 图片可以并发，视频顺序下载（减少站点风控与进度互相覆盖）
    let cursor = 0;
    if (images.length) {
      await MS.util.pool(images, MS.util.clamp(MS.conf.concurrency, 1, 6), (it, i) => download(it, i));
      cursor = images.length;
    }
    for (let i = 0; i < rest.length; i++) {
      await download(rest[i], cursor + i);
    }

    const ok = results.filter((r) => r.ok).length;
    // HLS 原始格式是 .ts，很多播放器/相册不认；提示一条无损转封装出路
    const tsFiles = results.filter((r) => r.ok && /\.ts$/i.test(r.name)).map((r) => r.name);
    if (tsFiles.length) MS.store.set('lastTsFiles', tsFiles);
    MS.bus.emit('batchDone', results);
    if (ok < results.length) {
      MS.ui.toast('完成 ' + ok + '/' + results.length + ' 个，' + (results.length - ok) + ' 个失败', 'warn');
      MS.util.warn('失败明细', results.filter((r) => !r.ok));
    }
    return results;
  },
};

/* ===== 50-hls.js ===== */
/* ============================================================
 * 50-hls —— HLS（m3u8）解析、AES-128 解密、分片合并下载
 * ============================================================ */

MS.hls = {
  /** 解析 m3u8 文本 */
  parse(text, baseUrl) {
    const out = {
      isMaster: false,
      variants: [],
      segments: [],
      map: null,
      key: null,
      mediaSequence: 0,
      targetDuration: 0,
      totalDuration: 0,
      version: 0,
      endList: false,
    };
    const lines = String(text).split(/\r?\n/);
    let pendingInf = null;
    let pendingRange = null;
    let pendingStream = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line[0] === '#') {
        const ci = line.indexOf(':');
        const tag = ci === -1 ? line : line.slice(0, ci);
        const val = ci === -1 ? '' : line.slice(ci + 1).trim();
        switch (tag) {
          case '#EXT-X-STREAM-INF':
            pendingStream = this.attrs(val);
            break;
          case '#EXTINF':
            pendingInf = parseFloat(val) || 0;
            out.totalDuration += pendingInf;
            break;
          case '#EXT-X-BYTERANGE':
            pendingRange = this.byteRange(val);
            break;
          case '#EXT-X-KEY': {
            const a = this.attrs(val);
            out.key = !a.METHOD || a.METHOD === 'NONE'
              ? null
              : {
                  method: a.METHOD,
                  uri: a.URI ? MS.util.absUrl(a.URI, baseUrl) : '',
                  iv: a.IV ? this.hexIv(a.IV) : null,
                  format: a.KEYFORMAT || 'identity',
                };
            break;
          }
          case '#EXT-X-MAP': {
            const a = this.attrs(val);
            out.map = {
              uri: a.URI ? MS.util.absUrl(a.URI, baseUrl) : '',
              byterange: a.BYTERANGE ? this.byteRange(a.BYTERANGE) : null,
            };
            break;
          }
          case '#EXT-X-MEDIA-SEQUENCE':
            out.mediaSequence = Number(val) || 0;
            break;
          case '#EXT-X-TARGETDURATION':
            out.targetDuration = Number(val) || 0;
            break;
          case '#EXT-X-VERSION':
            out.version = Number(val) || 0;
            break;
          case '#EXT-X-ENDLIST':
            out.endList = true;
            break;
          default:
            break;
        }
        continue;
      }

      const url = MS.util.absUrl(line, baseUrl);
      if (!url) continue;

      if (pendingStream) {
        out.isMaster = true;
        const res = /(\d+)\s*[x×]\s*(\d+)/.exec(pendingStream.RESOLUTION || '');
        out.variants.push({
          url,
          bandwidth: Number(pendingStream.BANDWIDTH) || Number(pendingStream['AVERAGE-BANDWIDTH']) || 0,
          width: res ? Number(res[1]) : 0,
          height: res ? Number(res[2]) : 0,
          codecs: pendingStream.CODECS || '',
          frameRate: Number(pendingStream['FRAME-RATE']) || 0,
        });
        pendingStream = null;
        continue;
      }

      out.segments.push({
        index: out.segments.length,
        url,
        duration: pendingInf || 0,
        seq: out.mediaSequence + out.segments.length,
        key: out.key,
        byterange: pendingRange,
      });
      pendingInf = null;
      pendingRange = null;
    }

    // 主播放列表：按清晰度从高到低排列
    out.variants.sort((a, b) => (b.height || b.bandwidth) - (a.height || a.bandwidth));
    return out;
  },

  attrs(str) {
    const out = {};
    const re = /([A-Za-z0-9-]+)=("[^"]*"|'[^']*'|[^,]*)/g;
    let m;
    while ((m = re.exec(str))) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      out[m[1].toUpperCase()] = v;
    }
    return out;
  },

  byteRange(str) {
    const [len, off] = String(str).split('@');
    return { length: Number(len) || 0, offset: off === undefined ? null : Number(off) || 0 };
  },

  hexIv(hex) {
    const s = String(hex).replace(/^0x/i, '').padStart(32, '0').slice(-32);
    const arr = new Uint8Array(16);
    for (let i = 0; i < 16; i++) arr[i] = parseInt(s.substr(i * 2, 2), 16) || 0;
    return arr;
  },

  /** 没有显式 IV 时，使用"媒体序号"作为 IV（HLS 规范） */
  seqIv(seq) {
    const arr = new Uint8Array(16);
    let n = Number(seq) || 0;
    for (let i = 15; i >= 8 && n > 0; i--) {
      arr[i] = n & 0xff;
      n = Math.floor(n / 256);
    }
    return arr;
  },

  variantLabel(v) {
    const parts = [];
    if (v.height) parts.push(v.height + 'p');
    else if (v.width) parts.push(v.width + 'px');
    if (v.bandwidth) parts.push(Math.round(v.bandwidth / 1000) + ' kbps');
    if (v.codecs) parts.push(/hvc|hev|h265/i.test(v.codecs) ? 'H.265' : /av01/i.test(v.codecs) ? 'AV1' : '');
    return parts.filter(Boolean).join(' · ') || '默认清晰度';
  },

  best(variants) {
    if (!variants.length) return null;
    return [...variants].sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth)[0];
  },

  /** 拉取并解析播放列表；若是主列表则选定清晰度后再解析一次 */
  async prepare(url, opts = {}) {
    const master = await this.load(url, opts);
    let playlist = master;
    let chosen = null;
    if (master.isMaster && master.variants.length) {
      chosen = opts.variant && opts.variant.url ? opts.variant : this.best(master.variants);
      if (!chosen) throw new Error('主播放列表里没有可用清晰度');
      playlist = await this.load(chosen.url, opts);
    }
    if (!playlist.segments.length) {
      throw new Error(playlist.isMaster ? '主播放列表里没有分片' : '播放列表里没有分片（可能是直播流、或地址已失效）');
    }
    const isFmp4 = !!playlist.map || playlist.segments.some((s) => /\.(m4s|m4f)$/i.test(s.url));
    return Object.assign(playlist, {
      master,
      chosen,
      ext: isFmp4 ? 'mp4' : 'ts',
      mime: isFmp4 ? 'video/mp4' : 'video/mp2t',
      sourceUrl: url,
    });
  },

  async load(url, opts = {}) {
    const text = await MS.net.text(url, { referer: opts.referer, timeout: 30000 });
    if (/^\s*</.test(text)) throw new Error('返回的不是播放列表（可能需要登录或地址已失效）');
    if (!/#EXTM3U/.test(text)) throw new Error('内容不是合法的 m3u8');
    const pl = this.parse(text, url);
    pl.url = url;
    return pl;
  },

  /** 取清晰度列表（供 UI 选择） */
  async variants(url, opts = {}) {
    const pl = await this.load(url, opts);
    if (!pl.isMaster) {
      return [{ url, label: '原始清晰度' + (pl.totalDuration ? ' · ' + MS.util.fmtDur(pl.totalDuration) : ''), segments: pl.segments.length, height: 0, bandwidth: 0 }];
    }
    const seen = new Set();
    return pl.variants
      .filter((v) => {
        const k = v.height + '/' + v.bandwidth;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((v) => Object.assign({}, v, { label: this.variantLabel(v) }));
  },

  /* ---------------- 下载 ---------------- */

  async decrypt(buf, key, seg, cache, referer) {
    if (!key || !key.method || key.method === 'NONE') return buf;
    if (key.method !== 'AES-128') {
      throw new Error('不支持的加密方式：' + key.method + '（SAMPLE-AES / DRM 无法在浏览器内解密）');
    }
    if (!key.uri) throw new Error('播放列表缺少密钥地址');
    let keyBuf = cache.get(key.uri);
    if (!keyBuf) {
      keyBuf = await MS.net.buffer(key.uri, { referer, timeout: 30000 });
      cache.set(key.uri, keyBuf);
    }
    const cryptoObj = MS.page.crypto || (typeof crypto !== 'undefined' ? crypto : null);
    if (!cryptoObj || !cryptoObj.subtle) throw new Error('当前环境不支持 WebCrypto，无法解密分片');
    const ck = await cryptoObj.subtle.importKey('raw', keyBuf, 'AES-CBC', false, ['decrypt']);
    const iv = key.iv || this.seqIv(seg.seq == null ? seg.index : seg.seq);
    const plain = await cryptoObj.subtle.decrypt({ name: 'AES-CBC', iv }, ck, buf);
    return this.stripPadding(plain);
  },

  /** WebCrypto 会自动去掉 PKCS#7 填充；个别实现不会，这里做一次带校验的兜底 */
  stripPadding(buf) {
    const bytes = new Uint8Array(buf);
    if (bytes.byteLength % 188 === 0) return buf;
    const last = bytes[bytes.byteLength - 1];
    if (last >= 1 && last <= 16 && bytes.byteLength - last > 0 && (bytes.byteLength - last) % 188 === 0) {
      let ok = true;
      for (let i = bytes.byteLength - last; i < bytes.byteLength; i++) {
        if (bytes[i] !== last) {
          ok = false;
          break;
        }
      }
      if (ok) return bytes.slice(0, bytes.byteLength - last);
    }
    return buf;
  },

  async getSegment(seg, pl, cache, referer) {
    const headers = {};
    if (seg.byterange && seg.byterange.length) {
      const start = seg.byterange.offset || 0;
      headers.Range = 'bytes=' + start + '-' + (start + seg.byterange.length - 1);
    }
    let buf = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3 && !buf; attempt++) {
      try {
        buf = await MS.net.buffer(seg.url, { referer, headers, timeout: 120000 });
      } catch (e) {
        lastErr = e;
        await MS.util.sleep(400 * attempt);
      }
    }
    if (!buf) throw new Error('分片下载失败：' + seg.url + '（' + (lastErr && lastErr.message) + '）');
    const key = seg.key !== undefined ? seg.key : pl.key;
    return this.decrypt(buf, key, seg, cache, referer);
  },

  /**
   * 下载整条流并写入 sink（或内存拼接）
   * @param {object} pl prepare() 的结果
   * @param {{referer:string, sink?:object, parts?:any[], name:string, task?:object}} ctx
   */
  async fetchAll(pl, ctx) {
    const { referer, sink, task } = ctx;
    const parts = ctx.parts || [];
    const segs = pl.segments;
    const total = segs.length;
    const cache = new Map();
    let written = 0;
    let bytes = 0;
    let nextIndex = 0;
    let failed = null;
    const pending = new Map();
    let tail = Promise.resolve();

    const report = (phase) => {
      if (!task) return;
      MS.dl.updateTask(task, { total, loaded: written, bytes, phase });
    };

    const enqueueWrite = (buf) => {
      tail = tail.then(async () => {
        if (sink) await sink.write(buf);
        else parts.push(buf);
        written++;
        bytes += buf.byteLength || buf.size || 0;
        report(written + '/' + total + ' · ' + MS.util.fmtBytes(bytes));
      });
      return tail;
    };

    const drain = () => {
      while (pending.has(nextIndex)) {
        const buf = pending.get(nextIndex);
        pending.delete(nextIndex);
        nextIndex++;
        enqueueWrite(buf);
      }
    };

    try {
      if (pl.map && pl.map.uri) {
        const initBuf = await this.getSegment({ url: pl.map.uri, byterange: pl.map.byterange, key: null, index: -1, seq: 0 }, pl, cache, referer);
        if (sink) await sink.write(initBuf);
        else parts.push(initBuf);
        bytes += initBuf.byteLength || 0;
      }

      report('0/' + total);
      await MS.util.pool(segs, MS.util.clamp(MS.conf.concurrency, 1, 8), async (seg) => {
        if (failed) return;
        try {
          const buf = await this.getSegment(seg, pl, cache, referer);
          pending.set(seg.index, buf);
          drain();
        } catch (e) {
          failed = failed || e;
        }
      });
      await tail;
      if (failed) throw failed;

      if (!sink) {
        const blob = new Blob(parts, { type: pl.mime });
        await MS.dl.saveBlob(blob, ctx.name);
      }
      if (task) MS.dl.updateTask(task, { total, loaded: total, bytes, phase: '完成' });
      return { bytes, ext: pl.ext, segments: total, duration: pl.totalDuration };
    } catch (e) {
      try {
        await tail;
      } catch (err) {
        /* 忽略 */
      }
      throw e;
    }
  },

  /** 一步到位：解析 + 下载 */
  async download(url, ctx) {
    const pl = await this.prepare(url, { referer: ctx.referer, variant: ctx.variant });
    if (ctx.task) MS.dl.updateTask(ctx.task, { total: pl.segments.length, phase: '解析完成，共 ' + pl.segments.length + ' 段' });
    return this.fetchAll(pl, ctx);
  },
};

/* ===== 60-sites.js ===== */
/* ============================================================
 * 60-sites —— 站点规则：原图还原、防盗链、头像过滤、页面内嵌数据扫描
 * ============================================================ */

/** 常见图片/视频尺寸目录或后缀 → 原图 */
const WEIBO_THUMB_DIR = /\/(orj360|orj480|orj720|thumbnail|thumb150|thumb180|thumb300|small|bmiddle|mw2000|mw690|mw600|wap\d+|square|crop\.\d+\.\d+\.\d+\.\d+)\//i;
/** 知乎图片的尺寸目录：/80/、/100/ 之类，以及 1440w 这种宽度写法 */
const ZHIHU_SIZE_DIR = /\/(?:\d+x\d+|\d+w|\d+h|50|80|100|200|240|360|480|540|720|800|960|1080|1200|1440)\//g;
const ZHIHU_SIZE_SUFFIX = /_(?:\d+w|\d+h|\d+x\d+|xs|hd|qhd|[blmsr])\.(jpe?g|png|webp|gif|avif|heic)/i;

MS.SITES = [
  {
    id: 'weibo',
    name: '微博',
    hostRe: /(^|\.)(weibo\.(com|cn|tv)|sina\.com\.cn|sinaimg\.cn|weibocdn\.com)$/i,
    referer: 'https://weibo.com/',
    imageHostRe: /(^|\.)sinaimg\.cn$/i,
    videoHostRe: /(weibocdn\.com|video\.weibo\.com|sina\.com\.cn)$/i,
    contentHostRe: /^w[xws]\d*\.sinaimg\.cn$/i,
    decorRe: /^(tva\d*x?\d*|tvportrait\d*|avatar\d*)\.sinaimg\.cn$|sinaimg\.cn\/(thumbnail|crop\.\d+\.\d+\.\d+\.\d+)/i,
    /** 微博缩略图 /large/ 即原图 */
    upgradeImage(url) {
      return url.replace(WEIBO_THUMB_DIR, '/large/');
    },
  },
  {
    id: 'zhihu',
    name: '知乎',
    hostRe: /(^|\.)(zhihu\.com|zhimg\.com|vzuu\.com)$/i,
    referer: 'https://www.zhihu.com/',
    imageHostRe: /(^|\.)zhimg\.com$/i,
    videoHostRe: /(zhihu\.com|vzuu\.com)$/i,
    decorRe: /_(?:xs|s|m)\.(?:jpe?g|png|webp|gif)|zhihu\.com\/people\/|\/avatar\//i,
    /** 去掉 /80/ 尺寸目录与 _1440w 之类的后缀 */
    upgradeImage(url) {
      let u = url.replace(ZHIHU_SIZE_DIR, '/');
      u = u.replace(ZHIHU_SIZE_SUFFIX, '.$1');
      return u;
    },
  },
  {
    id: 'xiaohongshu',
    name: '小红书',
    hostRe: /(^|\.)(xiaohongshu\.com|xhscdn\.com)$/i,
    referer: 'https://www.xiaohongshu.com/',
    imageHostRe: /(^|\.)(xhscdn\.com|ci\.xiaohongshu\.com)$/i,
    videoHostRe: /(xhscdn\.com\/stream|xhscdn\.com\/spectrum|sns-video)/i,
    decorRe: /sns-avatar|avatar|fe-platform|\/logo|\/icon/i,
    /** 去掉 !nd_dft_wgth_webp_3 之类的处理后缀和 imageView2 参数 */
    upgradeImage(url) {
      return url.replace(/!.+$/, '').replace(/\?imageView2.*$/i, '');
    },
  },
  {
    id: 'bilibili',
    name: '哔哩哔哩',
    hostRe: /(^|\.)(bilibili\.com|hdslb\.com|bilivideo\.(com|cn)|biliapi\.net)$/i,
    referer: 'https://www.bilibili.com/',
    imageHostRe: /(^|\.)hdslb\.com$/i,
    videoHostRe: /(bilivideo|akamaized\.net)/i,
    decorRe: /(face|avatar|icon|logo|emoji)/i,
    upgradeImage(url) {
      // @\d+w_\d+h 之类的裁剪参数去掉
      return url.replace(/@[^!?]*$/, '');
    },
  },
];

MS.GENERIC_SITE = {
  id: 'generic',
  name: '',
  hostRe: /.*/,
  referer: '',
  imageHostRe: null,
  videoHostRe: null,
  decorRe: /(avatar|headimg|portrait|icon|logo|emoji|sprite|favicon)/i,
  upgradeImage(url) {
    return url;
  },
};

/* ---------------------- 站点上下文 ---------------------- */

MS.sites = {
  list: MS.SITES,
  current: null,
  _title: '',

  init() {
    const host = location.hostname;
    this.current = this.list.find((s) => s.hostRe.test(host)) || Object.assign({}, MS.GENERIC_SITE, {
      name: host.replace(/^www\./, ''),
      referer: location.origin + '/',
    });
    MS.util.log('当前站点规则：', this.current.id, this.current.name);
    return this.current;
  },

  /** 是否在该站点启用自动 UI（未列出的站点需从菜单手动打开） */
  enabled() {
    const conf = MS.conf.siteEnabled || {};
    if (conf[this.current.id] !== undefined) return !!conf[this.current.id];
    return !!conf.generic;
  },

  referer() {
    return this.current.referer || location.origin + '/';
  },

  upgradeImage(url) {
    try {
      return this.current.upgradeImage(url);
    } catch (e) {
      return url;
    }
  },

  /** 页面标题，用于文件名 */
  title() {
    if (this._title) return this._title;
    let t = '';
    const og = MS.dom.qs('meta[property="og:title"]');
    if (og) t = og.getAttribute('content') || '';
    if (!t) {
      const h1 = MS.dom.qs('h1, #detail-title, .QuestionHeader-title, .head_title');
      if (h1) t = h1.textContent || '';
    }
    if (!t) t = document.title || '';
    t = t.replace(/[-_|·]\s*(微博|知乎|小红书|哔哩哔哩|weibo|zhihu|xiaohongshu|bilibili).*$/i, '').trim();
    this._title = MS.util.sanitize(t, 36);
    return this._title;
  },

  resetTitle() {
    this._title = '';
  },

  /* ---------------- 页面内嵌数据扫描 ---------------- */

  /**
   * 扫描页面里"还没被播放器请求过"的媒体地址：
   * 微博在 $render_data / FM.view、知乎在 #js-initialData、小红书在 __INITIAL_STATE__
   * 这些都是内联 script，统一按文本 + 全局对象两种方式捞
   */
  scanPage() {
    const found = [];
    const push = (url, meta) => {
      const item = MS.sniffer.add(url, meta);
      if (item && !found.includes(item)) found.push(item);
    };
    // 微博图集只给图片 id 的情况：站点不是微博时（例如第三方页面嵌入微博内容），
    // 只要页面里出现了新浪图床，同样按微博规则还原
    let weiboLike = this.current.id === 'weibo';
    let jsonOrder = 0;

    const fromString = (str, path, key, ctx) => {
      if (!str) return;
      // 微博图集有时只给图片 id
      if (weiboLike && /^(pic_?ids?|image_?ids?|img_?ids?)$/i.test(key || '') && /^[0-9a-zA-Z]{15,}$/.test(str)) {
        push('https://wx1.sinaimg.cn/large/' + str + '.jpg', { source: 'page:picid', hint: 'content', order: 100 + jsonOrder++, author: ctx && ctx.author });
        return;
      }
      if (str.length > 12 && str.includes('http') && /(url|src|play|video|image|img|pic|poster|cover|media)/i.test(key || '')) {
        // 播放地址往往嵌得很深，ctx 是这一层继承下来的"属于哪条微博 / 哪篇笔记"
        push(str, {
          source: 'page:json',
          order: 100 + jsonOrder++,
          title: ctx && ctx.title,
          author: ctx && ctx.author,
          poster: ctx && ctx.cover,
        });
      }
    };

    // 1) 全局对象深扫
    for (const key of ['__INITIAL_STATE__', '__INITIAL_DATA__', '__NEXT_DATA__', '__NUXT__', '__PRELOADED_STATE__', 'initialState', '$render_data', 'render_data', '__APOLLO_STATE__']) {
      try {
        const val = MS.page[key];
        if (val && typeof val === 'object') MS.util.deepWalk(val, fromString);
      } catch (e) {
        /* 忽略 */
      }
    }

    // 2) 内联脚本文本里的 URL
    const urlRe = /https?:\/\/[^\s"'`<>\\)\]}]+/g;
    let scanned = 0;
    for (const script of MS.dom.qsa('script')) {
      const text = script.textContent;
      if (!text || text.length < 20 || scanned > 60) continue;
      scanned++;
      const clean = text.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
      if (!weiboLike && /sinaimg\.cn/.test(clean)) weiboLike = true;
      let m;
      urlRe.lastIndex = 0;
      while ((m = urlRe.exec(clean))) {
        push(m[0].replace(/[,;]+$/, ''), { source: 'page:script', order: 100 + jsonOrder++ });
      }
      // 顺带扫一遍脚本里的 JSON（能拿到 pic_id 这类 id）
      if (weiboLike && /"pic_ids?"\s*:/.test(clean)) {
        const idRe = /"(?:pic_ids?|image_ids?)"\s*:\s*\[([^\]]*)\]/g;
        let im;
        while ((im = idRe.exec(clean))) {
          for (const id of im[1].split(',')) {
            const v = id.trim().replace(/^"|"$/g, '');
            if (/^[0-9a-zA-Z]{15,}$/.test(v)) push('https://wx1.sinaimg.cn/large/' + v + '.jpg', { source: 'page:picid', hint: 'content', order: 100 + jsonOrder++ });
          }
        }
      }
    }

    // 3) DOM 里已经渲染出来的媒体
    let domIndex = 0;
    for (const el of MS.dom.qsa('video, source, img')) {
      this.fromElement(el, push, domIndex++);
    }

    MS.util.log('页面扫描完成，新发现 ' + found.length + ' 条');
    return found;
  },

  /**
   * 从媒体元素往回找它所属的"卡片"（微博 / 笔记 / 回答），抠出作者与正文片段。
   * 这是用户分辨"哪个视频是哪个"最直接的线索。
   */
  contextOf(el) {
    if (!el || !el.parentElement) return null;
    let node = el;
    let card = null;
    for (let i = 0; i < 9 && node; i++) {
      node = node.parentElement;
      if (!node || node === document.body || node === document.documentElement) break;
      const text = String(node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length >= 12) {
        if (!card) card = node;
        if (text.length > 600) break;
      }
    }
    if (!card) return null;
    try {
      const authorEl =
        MS.dom.qs('a[href*="/u/"]', card) ||
        MS.dom.qs('[class*=nickname], [class*=user-name], [class*=username], [class*=author]', card) ||
        MS.dom.qs('[class*=name]', card);
      const author = authorEl ? MS.util.cleanText(authorEl.textContent, 20) : '';
      const textEl = MS.dom.qs('[class*=note-text], [class*=desc], .txt, [class*=text], [class*=content], .RichContent', card);
      let excerpt = textEl && textEl !== el ? MS.util.cleanText(textEl.textContent, 60) : '';
      if (!excerpt) excerpt = MS.util.cleanText(card.innerText || card.textContent, 60);
      return { author, title: excerpt };
    } catch (e) {
      return null;
    }
  },

  fromElement(el, push, index) {
    const tag = el.tagName;
    const order = index == null ? null : index;
    if (tag === 'VIDEO') {
      const src = el.currentSrc || el.src;
      const ctx = this.contextOf(el);
      if (src) {
        push(src, {
          source: 'dom:video',
          hint: 'content',
          order,
          poster: el.poster || '',
          title: ctx && ctx.title,
          author: ctx && ctx.author,
        });
      }
      const poster = el.poster;
      if (poster) push(poster, { source: 'dom:poster', order });
      return;
    }
    if (tag === 'SOURCE') {
      const src = el.src || el.getAttribute('src');
      if (src) push(MS.util.absUrl(src), { source: 'dom:source', hint: 'content', order });
      return;
    }
    // IMG：用渲染尺寸区分内容图与图标
    const src = el.currentSrc || el.src || el.dataset.src || el.dataset.original || el.getAttribute('data-src');
    if (!src || src.startsWith('data:')) return;
    const rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
    const big = Math.max(rect.width || 0, rect.height || 0, el.naturalWidth || 0, el.naturalHeight || 0) >= 160;
    const ctx = big ? this.contextOf(el) : null;
    push(MS.util.absUrl(src), {
      source: 'dom:img',
      hint: big ? 'content' : 'decor',
      order,
      author: ctx && ctx.author,
      title: ctx && ctx.title,
    });
  },

  /* ---------------- 同源多清晰度合并 ---------------- */

  /** 把一个视频的多个清晰度合成一条（微博的 playback_list 就是这种结构） */
  collapseVariants(items) {
    const groups = new Map();
    const others = [];
    for (const it of items) {
      if (it.kind !== 'video' && it.kind !== 'unknown') {
        others.push(it);
        continue;
      }
      let path = it.url;
      try {
        const u = new URL(it.url);
        path = u.host + u.pathname;
      } catch (e) {
        /* 忽略 */
      }
      if (!groups.has(path)) groups.set(path, []);
      groups.get(path).push(it);
    }

    const out = [...others];
    for (const [, list] of groups) {
      if (list.length === 1) {
        out.push(list[0]);
        continue;
      }
      const variants = list
        .map((it) => Object.assign(it, { quality: this.qualityOf(it.url) }))
        .sort((a, b) => b.quality.rank - a.quality.rank);
      // 只有能确认是"同一视频的不同清晰度"时才合并：
      // 路径相同但查询参数与清晰度无关时（比如 ?take=2），可能是两个完全不同的视频
      if (variants.filter((v) => v.quality.rank > 1).length < 2) {
        out.push(...variants);
        continue;
      }
      const head = variants[0];
      head.variants = variants;
      if (!head.chosen) head.chosen = variants[0].url;
      out.push(head);
    }
    return out;
  },

  qualityOf(url) {
    const label = /[?&]label=([^&]+)/i.exec(url);
    const res = /(?:^|[^0-9])(\d{3,4})p(?:[^0-9]|$)/i.exec(url) || /(\d{3,4})[x×](\d{3,4})/.exec(url);
    let name = '';
    let rank = 0;
    if (label) {
      const l = decodeURIComponent(label[1]).toLowerCase();
      name = l.replace(/^mp4_/, '').replace(/_mp4$/, '');
      const n = Number((/(\d{3,4})/.exec(name) || [])[1]) || 0;
      rank = n || (name.includes('hd') ? 720 : name.includes('sd') ? 480 : name.includes('ld') ? 360 : 0);
    } else if (res) {
      name = (res[2] ? res[2] + 'p' : res[1] + 'p');
      rank = Number(res[2] || res[1]) || 0;
    }
    if (!name) {
      name = '默认';
      rank = 1;
    }
    return { name, rank };
  },
};

/* ===== 70-ui.js ===== */
/* ============================================================
 * 70-ui —— 悬浮面板：媒体列表、批量下载、进度、设置
 * ============================================================ */

MS.UI_CSS = `
.ms-root, .ms-root * { box-sizing: border-box; }
.ms-root {
  --ms-bg:#ffffff; --ms-bg2:#f7f8fa; --ms-fg:#1b1f24; --ms-muted:#6b7280;
  --ms-line:#e6e8eb; --ms-accent:#2563eb; --ms-accent-fg:#ffffff;
  --ms-ok:#16a34a; --ms-warn:#d97706; --ms-danger:#dc2626; --ms-shadow:0 12px 34px rgba(15,23,42,.18);
  position: fixed; z-index: 2147483000; inset: auto 0 0 auto;
  font: 12px/1.55 -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  color: var(--ms-fg); -webkit-font-smoothing: antialiased;
}
@media (prefers-color-scheme: dark) {
  .ms-root { --ms-bg:#1b1f24; --ms-bg2:#23282e; --ms-fg:#e6e8eb; --ms-muted:#9aa3ad;
    --ms-line:#333a42; --ms-accent:#4c8bf5; --ms-shadow:0 12px 34px rgba(0,0,0,.55); }
}
.ms-root .ms-fab {
  position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 6px;
  padding: 8px 12px; border-radius: 999px; background: var(--ms-bg); color: var(--ms-fg);
  border: 1px solid var(--ms-line); box-shadow: var(--ms-shadow); cursor: pointer; user-select: none;
}
.ms-root .ms-fab:hover { border-color: var(--ms-accent); }
.ms-root .ms-fab .ms-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ms-ok); }
.ms-root .ms-fab.ms-idle .ms-dot { background: var(--ms-muted); }
.ms-root .ms-fab b { font-weight: 600; font-variant-numeric: tabular-nums; }
.ms-root .ms-fab small { color: var(--ms-muted); }
.ms-root .ms-panel {
  position: fixed; right: 16px; bottom: 62px; width: 432px; max-width: calc(100vw - 24px);
  max-height: 72vh; display: none; flex-direction: column; overflow: hidden;
  background: var(--ms-bg); border: 1px solid var(--ms-line); border-radius: 14px; box-shadow: var(--ms-shadow);
}
.ms-root .ms-panel.ms-open { display: flex; }
.ms-root .ms-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--ms-line); cursor: move; background: var(--ms-bg2); }
.ms-root .ms-head .ms-title { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-root .ms-head .ms-title tagline { color: var(--ms-muted); font-weight: 400; }
.ms-root .ms-tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
.ms-root .ms-tabs button { padding: 4px 10px; border-radius: 999px; border: 1px solid transparent; background: transparent; color: var(--ms-muted); cursor: pointer; font: inherit; }
.ms-root .ms-tabs button.ms-on { background: var(--ms-bg2); border-color: var(--ms-line); color: var(--ms-fg); font-weight: 600; }
.ms-root .ms-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--ms-line); }
.ms-root .ms-bar .ms-count { color: var(--ms-muted); margin-left: auto; font-variant-numeric: tabular-nums; }
.ms-root button.ms-btn {
  padding: 4px 9px; border-radius: 7px; border: 1px solid var(--ms-line); background: var(--ms-bg);
  color: var(--ms-fg); cursor: pointer; font: inherit; white-space: nowrap;
}
.ms-root button.ms-btn:hover { border-color: var(--ms-accent); color: var(--ms-accent); }
.ms-root button.ms-btn.ms-primary { background: var(--ms-accent); border-color: var(--ms-accent); color: var(--ms-accent-fg); }
.ms-root button.ms-btn.ms-primary:hover { opacity: .9; color: var(--ms-accent-fg); }
.ms-root button.ms-btn.ms-icon { padding: 4px 7px; }
.ms-root .ms-list { overflow: auto; flex: 1; overscroll-behavior: contain; }
.ms-root .ms-row { display: grid; grid-template-columns: 16px 46px minmax(0,1fr); gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--ms-line); align-items: start; content-visibility: auto; contain-intrinsic-size: 62px; }
.ms-root .ms-row:hover { background: var(--ms-bg2); }
.ms-root .ms-row.ms-sel { background: color-mix(in srgb, var(--ms-accent) 10%, transparent); }
.ms-root .ms-check { margin-top: 4px; accent-color: var(--ms-accent); }
.ms-root .ms-thumb { width: 46px; height: 46px; border-radius: 8px; object-fit: cover; background: var(--ms-bg2); border: 1px solid var(--ms-line); display: flex; align-items: center; justify-content: center; color: var(--ms-muted); font-size: 16px; cursor: zoom-in; }
.ms-root .ms-main { min-width: 0; }
.ms-root .ms-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
.ms-root .ms-title .ms-author { color: var(--ms-accent); }
.ms-root .ms-title .ms-author::after { content: '：'; color: var(--ms-muted); font-weight: 400; }
.ms-root .ms-url { font-size: 11px; color: var(--ms-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.ms-root .ms-meta { display: flex; flex-wrap: wrap; gap: 6px; color: var(--ms-muted); margin-top: 2px; font-size: 11px; }
.ms-root .ms-badge { padding: 0 6px; border-radius: 5px; background: var(--ms-bg2); border: 1px solid var(--ms-line); }
.ms-root .ms-badge.ms-video { color: var(--ms-accent); border-color: currentColor; }
.ms-root .ms-badge.ms-img { color: var(--ms-ok); border-color: currentColor; }
.ms-root .ms-badge.ms-seg { color: var(--ms-warn); border-color: currentColor; }
.ms-root .ms-acts { display: flex; gap: 6px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
.ms-root select.ms-sel { font: inherit; padding: 2px 4px; border-radius: 6px; border: 1px solid var(--ms-line); background: var(--ms-bg); color: var(--ms-fg); max-width: 130px; }
.ms-root .ms-empty { padding: 26px 14px; text-align: center; color: var(--ms-muted); }
.ms-root .ms-empty p { margin: 4px 0; }
.ms-root .ms-foot { display: flex; gap: 8px; align-items: center; padding: 8px 12px; border-top: 1px solid var(--ms-line); background: var(--ms-bg2); }
.ms-root .ms-foot input[type=text] { flex: 1; min-width: 0; font: inherit; padding: 4px 7px; border-radius: 7px; border: 1px solid var(--ms-line); background: var(--ms-bg); color: var(--ms-fg); }
.ms-root .ms-foot label { display: flex; align-items: center; gap: 4px; color: var(--ms-muted); white-space: nowrap; cursor: pointer; }
.ms-root .ms-tasks { position: fixed; left: 16px; bottom: 16px; width: 300px; max-width: calc(100vw - 32px); display: flex; flex-direction: column; gap: 6px; }
.ms-root .ms-task { background: var(--ms-bg); border: 1px solid var(--ms-line); border-radius: 10px; box-shadow: var(--ms-shadow); padding: 7px 10px; }
.ms-root .ms-task .ms-tname { display: flex; justify-content: space-between; gap: 8px; }
.ms-root .ms-task .ms-tname span:first-child { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ms-root .ms-task .ms-tname span:last-child { color: var(--ms-muted); flex-shrink: 0; }
.ms-root .ms-track { height: 4px; border-radius: 4px; background: var(--ms-bg2); margin-top: 5px; overflow: hidden; }
.ms-root .ms-fill { height: 100%; width: 0; background: var(--ms-accent); transition: width .2s; }
.ms-root .ms-task.ms-error { border-color: var(--ms-danger); }
.ms-root .ms-task.ms-error .ms-fill { background: var(--ms-danger); }
.ms-root .ms-task.ms-done .ms-fill { background: var(--ms-ok); }
.ms-root .ms-toast { position: fixed; left: 50%; bottom: 26px; transform: translateX(-50%); max-width: 76vw;
  background: var(--ms-bg); border: 1px solid var(--ms-line); box-shadow: var(--ms-shadow); border-radius: 10px;
  padding: 8px 14px; opacity: 0; transition: opacity .2s; pointer-events: none; }
.ms-root .ms-toast.ms-show { opacity: 1; }
.ms-root .ms-modal { position: fixed; inset: 0; background: rgba(15,23,42,.45); display: flex; align-items: center; justify-content: center; }
.ms-root .ms-modal .ms-box { background: var(--ms-bg); border-radius: 14px; box-shadow: var(--ms-shadow); width: 400px; max-width: calc(100vw - 32px); max-height: 80vh; overflow: auto; padding: 14px 16px; }
.ms-root .ms-box h3 { margin: 0 0 10px; font-size: 13px; }
.ms-root .ms-box .ms-field { display: flex; align-items: center; gap: 8px; padding: 5px 0; }
.ms-root .ms-box .ms-field label { flex: 1; }
.ms-root .ms-box .ms-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
.ms-root .ms-hint { color: var(--ms-muted); font-size: 11px; margin: 6px 0 0; }
.ms-root .ms-spin { display: inline-block; width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid var(--ms-muted); border-top-color: transparent; animation: ms-rot .7s linear infinite; vertical-align: -1px; }
@keyframes ms-rot { to { transform: rotate(360deg); } }
`;

MS.ui = {
  mounted: false,
  root: null,
  panel: null,
  listEl: null,
  fab: null,
  selected: new Set(),
  filter: 'all',
  filtered: [],

  mount(showFab = true) {
    if (this.mounted || this._mounting) return;
    if (!document.body) {
      if (this._pending) return;
      this._pending = true;
      document.addEventListener('DOMContentLoaded', () => {
        this._pending = false;
        this.mount(showFab);
      }, { once: true });
      return;
    }
    this._mounting = true;
    this.mounted = true;
    try {
      if (typeof GM_addStyle === 'function') GM_addStyle(MS.UI_CSS);
      else document.head.append(MS.dom.h('style', { text: MS.UI_CSS }));
    } catch (e) {
      document.head.append(MS.dom.h('style', { text: MS.UI_CSS }));
    }

    this.fab = MS.dom.h('div.ms-fab.ms-idle', { title: '媒体嗅探下载器（Alt+S）', onclick: () => this.toggle() },
      MS.dom.h('span.ms-dot'),
      MS.dom.h('b', { text: '0' }),
      MS.dom.h('small', { text: '媒体' })
    );

    this.listEl = MS.dom.h('div.ms-list');
    this.listEl.addEventListener('click', (e) => this.onListClick(e));
    this.listEl.addEventListener('change', (e) => this.onListChange(e));
    this.listEl.addEventListener('mouseover', (e) => {
      const row = e.target.closest('.ms-row');
      if (row) this.onRowHover(row);
    });

    this.panel = MS.dom.h('div.ms-panel',
      this.buildHead(),
      this.buildTabs(),
      this.buildBar(),
      this.listEl,
      this.buildFoot()
    );

    this.taskEl = MS.dom.h('div.ms-tasks');
    this.toastEl = MS.dom.h('div.ms-toast');

    if (!showFab) this.fab.style.display = 'none';
    this.root = MS.dom.h('div.ms-root', this.fab, this.panel, this.taskEl, this.toastEl);
    document.body.append(this.root);
    this._mounting = false;
    this.makeDraggable(this.panel, this.panel.querySelector('.ms-head'));

    MS.bus.on('media', (item) => {
      this.updateFab();
      if (this.isOpen()) this.appendRow(item);
      if (MS.conf.autoOpenPanel && !this.isOpen()) this.toggle(true);
    });
    MS.bus.on('probe', (item) => {
      if (this.isOpen()) this.updateRow(item);
    });
    MS.bus.on('reset', () => {
      this.selected.clear();
      this.updateFab();
      if (this.isOpen()) this.render();
    });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        this.toggle();
      }
    });
    this.updateFab();
    MS.util.log('面板已挂载');
  },

  buildHead() {
    return MS.dom.h('div.ms-head',
      MS.dom.h('div.ms-title', MS.dom.h('span', { text: MS.NAME }), ' ', MS.dom.h('tagline', { text: '· ' + (MS.sites.current ? MS.sites.current.name : '') })),
      MS.dom.h('button.ms-btn.ms-icon', { title: '重新扫描本页', text: '⟳', onclick: () => this.rescan() }),
      MS.dom.h('button.ms-btn.ms-icon', { title: '设置', text: '⚙', onclick: () => this.settingsDialog() }),
      MS.dom.h('button.ms-btn.ms-icon', { title: '关闭（Alt+S）', text: '✕', onclick: () => this.toggle(false) })
    );
  },

  buildTabs() {
    const tabs = [['all', '全部'], ['video', '视频'], ['image', '图片'], ['segment', '分片']];
    const box = MS.dom.h('div.ms-tabs');
    for (const [key, label] of tabs) {
      box.append(MS.dom.h('button', {
        dataset: { tab: key },
        text: label,
        onclick: () => {
          this.filter = key;
          this.render();
        },
      }));
    }
    return box;
  },

  buildBar() {
    return MS.dom.h('div.ms-bar',
      MS.dom.h('button.ms-btn.ms-primary', { text: '下载选中', onclick: () => this.downloadSelected() }),
      MS.dom.h('button.ms-btn', { text: '下载视频', title: '下载当前列出的所有视频 / HLS 流', onclick: () => this.downloadAll('video') }),
      MS.dom.h('button.ms-btn', { text: '下载图片', onclick: () => this.downloadAll('image') }),
      MS.dom.h('button.ms-btn', { text: '合并分片', title: '站点没有暴露 m3u8、只暴露了 ts/m4s 分片时，按顺序合并成一个文件', onclick: () => this.mergeSegments() }),
      MS.dom.h('button.ms-btn.ms-icon', { text: '复制', title: '复制选中链接', onclick: () => this.copySelected() }),
      MS.dom.h('button.ms-btn.ms-icon', { text: '清空', title: '清空列表', onclick: () => { MS.sniffer.clear(); } }),
      MS.dom.h('span.ms-count')
    );
  },

  buildFoot() {
    const input = MS.dom.h('input', {
      type: 'text',
      name: 'ms-naming',
      'aria-label': '文件命名模板',
      value: MS.conf.naming,
      title: '可用变量：{site} {title} {index} {host} {ext}',
      onchange: (e) => {
        MS.conf.naming = e.target.value || MS.DEFAULT_CONF.naming;
        MS.saveConf();
        this.toast('命名模板已保存');
      },
    });
    const decor = MS.dom.h('input', {
      type: 'checkbox',
      name: 'ms-decor',
      'aria-label': '显示头像和图标',
      checked: MS.conf.showDecor,
      onchange: (e) => {
        MS.conf.showDecor = e.target.checked;
        MS.saveConf();
        this.render();
      },
    });
    return MS.dom.h('div.ms-foot', MS.dom.h('span', { text: '命名', style: { color: 'var(--ms-muted)' } }), input, MS.dom.h('label', decor, '头像/图标'));
  },

  /* ---------------- 渲染 ---------------- */

  isOpen() {
    return !!(this.panel && this.panel.classList.contains('ms-open'));
  },

  toggle(force) {
    if (!this.mounted) this.mount();
    if (!this.panel) return;
    const open = force === undefined ? !this.isOpen() : !!force;
    this.panel.classList.toggle('ms-open', open);
    if (open) {
      this.render();
      MS.media.probePending(this.filtered);
    }
  },

  updateFab() {
    if (!this.fab) return;
    const list = MS.sniffer.list({ decor: MS.conf.showDecor });
    const videos = list.filter((i) => ['video', 'hls', 'segment'].includes(i.kind)).length;
    this.fab.querySelector('b').textContent = String(list.length);
    this.fab.querySelector('small').textContent = videos ? videos + ' 视频' : '媒体';
    this.fab.classList.toggle('ms-idle', list.length === 0);
  },

  render() {
    if (!this.listEl) return;
    const all = MS.sniffer.list({ decor: MS.conf.showDecor });
    const collapsed = MS.sites.collapseVariants(all);
    this.filtered = collapsed.filter((it) => {
      if (this.filter === 'all') return true;
      if (this.filter === 'video') return ['video', 'hls', 'dash'].includes(it.kind);
      return it.kind === this.filter;
    });

    for (const btn of MS.dom.qsa('.ms-tabs button', this.panel)) {
      const key = btn.dataset.tab;
      const n = key === 'all' ? collapsed.length : collapsed.filter((it) => (key === 'video' ? ['video', 'hls', 'dash'].includes(it.kind) : it.kind === key)).length;
      const base = btn.dataset.base || (btn.dataset.base = btn.textContent.replace(/\(\d+\)$/, ''));
      btn.textContent = base + (n ? '(' + n + ')' : '');
      btn.classList.toggle('ms-on', key === this.filter);
    }

    const count = this.panel.querySelector('.ms-count');
    if (count) count.textContent = '选中 ' + this.selected.size + '/' + this.filtered.length;

    this.listEl.textContent = '';
    if (!this.filtered.length) {
      this.listEl.append(MS.dom.h('div.ms-empty',
        MS.dom.h('p', { text: '本页还没嗅探到媒体' }),
        MS.dom.h('p', { text: '播放一次视频、或往下滚动让图片加载，再点标题栏的 ⟳' }),
        MS.state.mse ? MS.dom.h('p', { text: '检测到流式播放（MSE）——播放中的视频分片会显示在「分片」里' }) : null
      ));
      this.updateFab();
      return;
    }
    const frag = document.createDocumentFragment();
    for (const item of this.filtered) frag.append(this.buildRow(item));
    this.listEl.append(frag);
    this.updateFab();
  },

  buildRow(item) {
    const kindClass = ['video', 'hls', 'dash'].includes(item.kind) ? 'ms-video' : item.kind === 'image' ? 'ms-img' : 'ms-seg';
    const isVideo = ['video', 'hls', 'dash', 'segment'].includes(item.kind);
    const previewSrc = item.poster || (item.kind === 'image' ? item.url : '');
    const thumb = previewSrc
      ? MS.dom.h('img.ms-thumb', {
          src: previewSrc,
          loading: 'lazy',
          decoding: 'async',
          referrerpolicy: 'no-referrer-when-downgrade',
          title: item.poster && isVideo ? '视频封面 · 点击在新标签页打开' : '点击预览',
          onclick: () => window.open(MS.sniffer.effectiveUrl(item), '_blank'),
        })
      : MS.dom.h('div.ms-thumb', {
          text: isVideo ? '▶' : '♪',
          title: isVideo ? '鼠标悬停可加载首帧预览 · 点击在新标签页打开' : '点击预览',
          onclick: () => window.open(MS.sniffer.effectiveUrl(item), '_blank'),
        });

    const meta = [];
    meta.push(MS.dom.h('span.ms-badge.' + kindClass, { text: MS.media.kindLabel(item.kind) }));
    if (item.size) meta.push(MS.dom.h('span', { text: MS.util.fmtBytes(item.size) }));
    else if (!item.probed) meta.push(MS.dom.h('span', MS.dom.h('i.ms-spin'), ' 探测中'));
    if (item.ext) meta.push(MS.dom.h('span', { text: '.' + item.ext }));
    meta.push(MS.dom.h('span', { text: item.host }));
    if (item.source.startsWith('page')) meta.push(MS.dom.h('span', { text: '页面数据' }));
    if (item.originUrl) meta.push(MS.dom.h('span', { text: item.useOrigin ? '原图' : '缩略图' }));
    if (item.relevance === 'decor') meta.push(MS.dom.h('span', { text: '头像/图标' }));

    const acts = [];
    if (item.variants && item.variants.length > 1) {
      const sel = MS.dom.h('select.ms-sel', {
        title: '选择清晰度',
        onchange: (e) => {
          item.chosen = e.target.value;
        },
      });
      for (const v of item.variants) {
        sel.append(MS.dom.h('option', { value: v.url, text: v.quality ? v.quality.name + (v.quality.name === '默认' ? '' : '') : v.url, selected: MS.sniffer.effectiveUrl(item) === v.url }));
      }
      acts.push(sel);
    }
    if (item.kind === 'hls' && !item.variants) {
      acts.push(MS.dom.h('button.ms-btn', { text: '清晰度', onclick: () => this.pickQuality(item) }));
    }
    if (item.originUrl) {
      acts.push(MS.dom.h('button.ms-btn', {
        text: item.useOrigin ? '用原图' : '用缩略图',
        title: '切换下载原图 / 缩略图',
        onclick: () => {
          item.useOrigin = !item.useOrigin;
          this.render();
        },
      }));
    }
    acts.push(
      MS.dom.h('button.ms-btn.ms-primary', { text: '下载', onclick: () => this.download([item]) }),
      MS.dom.h('button.ms-btn', { text: '链接', title: '复制直链', onclick: () => this.toast(MS.dl.copyText(MS.sniffer.effectiveUrl(item)) ? '已复制直链' : '复制失败', 'warn') })
    );

    const urlText = item.useOrigin && item.originUrl ? item.originUrl : item.url;
    const tip = [item.author && '作者：' + item.author, item.title && '文案：' + item.title].filter(Boolean).join('\n');
    const lines = [];
    // 视频靠"谁发的 + 说了什么"辨认；图片本身一眼能认，就不用占一行
    if (isVideo && (item.title || item.author)) {
      lines.push(
        MS.dom.h('div.ms-title',
          item.author ? MS.dom.h('span.ms-author', { text: item.author }) : null,
          item.title || '视频'
        )
      );
    }
    lines.push(MS.dom.h('div.ms-url', { text: urlText, title: tip || urlText }));

    return MS.dom.h('div.ms-row' + (this.selected.has(item.id) ? '.ms-sel' : ''), { dataset: { id: String(item.id) } },
      MS.dom.h('input.ms-check', { type: 'checkbox', checked: this.selected.has(item.id) }),
      thumb,
      MS.dom.h('div.ms-main',
        lines,
        MS.dom.h('div.ms-meta', meta),
        MS.dom.h('div.ms-acts', acts)
      )
    );
  },

  /** 只刷新一行：探测过程中如果整列表重排，会打断滚动与悬停预览 */
  updateRow(item) {
    if (!this.listEl || !item) return;
    const row = this.listEl.querySelector('.ms-row[data-id="' + item.id + '"]');
    if (row) row.replaceWith(this.buildRow(item));
  },

  /** 悬停 300ms 后加载首帧预览 */
  onRowHover(row) {
    clearTimeout(this._hoverTimer);
    const id = Number(row.dataset.id);
    this._hoverTimer = setTimeout(() => {
      const item = MS.sniffer.byId(id);
      if (!item || item.kind === 'image' || item.poster) return;
      const box = this.listEl.querySelector('.ms-row[data-id="' + id + '"] .ms-thumb');
      if (box) this.loadFirstFrame(box, item);
    }, 300);
  },

  /** 让浏览器自己取第一帧：不需要把整段视频下下来 */
  loadFirstFrame(box, item) {
    if (!box || box.dataset.loading || box.dataset.frame) return;
    box.dataset.loading = '1';
    const video = MS.dom.h('video', {
      src: MS.sniffer.effectiveUrl(item),
      muted: true,
      preload: 'metadata',
      playsinline: true,
      style: { width: '100%', height: '100%', objectFit: 'cover' },
    });
    const timer = setTimeout(() => fail('加载超时'), 9000);
    function fail(why) {
      if (box.dataset.frame === 'ok') return;
      clearTimeout(timer);
      box.dataset.loading = '';
      box.dataset.frame = 'fail';
      box.title = '无法预览（' + why + '），可下载后查看';
      video.remove();
    }
    video.addEventListener('error', () => fail('地址不可播放'), { once: true });
    video.addEventListener(
      'loadeddata',
      () => {
        clearTimeout(timer);
        box.dataset.loading = '';
        box.dataset.frame = 'ok';
        box.textContent = '';
        box.append(video);
      },
      { once: true }
    );
    video.addEventListener(
      'loadedmetadata',
      () => {
        try {
          video.currentTime = Math.min(0.4, (video.duration || 1) * 0.05);
        } catch (e) {
          /* 忽略 */
        }
      },
      { once: true }
    );
  },

  /** 增量追加（嗅探很频繁，全量重排会打断滚动） */
  appendRow(item) {
    if (this.filter !== 'all') {
      this.render();
      return;
    }
    if (this.filtered.includes(item)) return;
    if (item.relevance === 'decor' && !MS.conf.showDecor) return;
    this.filtered.push(item);
    const empty = this.listEl.querySelector('.ms-empty');
    if (empty) empty.remove();
    this.listEl.prepend(this.buildRow(item));
    const count = this.panel.querySelector('.ms-count');
    if (count) count.textContent = '选中 ' + this.selected.size + '/' + this.filtered.length;
  },

  /* ---------------- 交互 ---------------- */

  onListClick(e) {
    const row = e.target.closest('.ms-row');
    if (!row) return;
    if (e.target.closest('button, select, input, .ms-thumb')) return;
    const id = Number(row.dataset.id);
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    row.classList.toggle('ms-sel', this.selected.has(id));
    const box = row.querySelector('.ms-check');
    if (box) box.checked = this.selected.has(id);
    const count = this.panel.querySelector('.ms-count');
    if (count) count.textContent = '选中 ' + this.selected.size + '/' + this.filtered.length;
  },

  onListChange(e) {
    const row = e.target.closest('.ms-row');
    if (!row || !e.target.classList.contains('ms-check')) return;
    const id = Number(row.dataset.id);
    if (e.target.checked) this.selected.add(id);
    else this.selected.delete(id);
    row.classList.toggle('ms-sel', e.target.checked);
    const count = this.panel.querySelector('.ms-count');
    if (count) count.textContent = '选中 ' + this.selected.size + '/' + this.filtered.length;
  },

  /** 从当前筛选结果里取条目 */
  pick(kind) {
    return this.filtered.filter((it) => (kind ? (kind === 'video' ? ['video', 'hls', 'dash'].includes(it.kind) : it.kind === kind) : true));
  },

  async downloadSelected() {
    const items = [...this.selected].map((id) => MS.sniffer.byId(id)).filter(Boolean);
    if (!items.length) {
      this.toast('先勾选要下载的条目（点行即可勾选）', 'warn');
      return;
    }
    this.toast('开始下载 ' + items.length + ' 个文件');
    // 注意：申请磁盘写入权限必须紧贴点击动作，不能先 await
    const results = await MS.dl.run(items, { plan: MS.dl.prepareSink(items) });
    this.afterDownload(results);
  },

  async download(items) {
    if (!items.length) return;
    const results = await MS.dl.run(items, { plan: MS.dl.prepareSink(items) });
    this.afterDownload(results);
  },

  async downloadAll(kind) {
    const items = this.pick(kind);
    if (!items.length) {
      this.toast('当前列表里没有' + (kind === 'video' ? '视频' : '图片'), 'warn');
      return;
    }
    this.toast('准备下载 ' + items.length + ' 个文件');
    const results = await MS.dl.run(items, { plan: MS.dl.prepareSink(items) });
    this.afterDownload(results);
  },

  /** 站点没暴露 m3u8、只暴露了 ts/m4s 分片时的兜底：按目录分组，顺序合并 */
  async mergeSegments() {
    const groups = MS.media.groupSegments(MS.sniffer.list({ decor: true }));
    if (!groups.length) {
      this.toast('没有发现成组的分片（需要先播放一次视频）', 'warn');
      return;
    }
    const group = groups[0];
    const isFmp4 = group.items.every((it) => /\.(m4s|m4f)$/i.test(it.url));
    const item = {
      id: -1,
      kind: 'segment',
      segmentGroup: group,
      url: group.items[0].url,
      ext: isFmp4 ? 'mp4' : 'ts',
      host: MS.util.hostOf(group.items[0].url),
      source: 'merge',
      probed: true,
    };
    this.toast('合并 ' + group.items.length + ' 个分片'); 
    const results = await MS.dl.run([item], { plan: MS.dl.prepareSink([item]) });
    this.afterDownload(results);
  },

  afterDownload(results) {
    if (!results) return;
    const ok = results.filter((r) => r.ok).length;
    const tsFiles = results.filter((r) => r.ok && /\.ts$/i.test(r.name));
    if (tsFiles.length) {
      this.toast('已下载 ' + ok + ' 个文件；其中 ' + tsFiles.length + ' 个是 HLS 原始格式 .ts，可点菜单里的「复制 TS→MP4 命令」无损转成 MP4');
    } else if (ok === results.length) {
      this.toast('已下载 ' + ok + ' 个文件');
    }
    if (typeof GM_notification === 'function' && results.length > 3) {
      try {
        GM_notification({ title: MS.NAME, text: '下载完成：成功 ' + ok + '/' + results.length, timeout: 4000 });
      } catch (e) {
        /* 忽略 */
      }
    }
  },

  copySelected() {
    const items = [...this.selected].map((id) => MS.sniffer.byId(id)).filter(Boolean);
    const list = items.length ? items : this.filtered;
    const text = list.map((it) => MS.sniffer.effectiveUrl(it)).join('\n');
    this.toast(MS.dl.copyText(text) ? '已复制 ' + list.length + ' 条链接' : '复制失败', 'warn');
  },

  rescan() {
    const found = MS.sites.scanPage();
    MS.media.probePending(this.filtered);
    this.toast('扫描完成，新增 ' + found.length + ' 条');
    this.render();
  },

  /** HLS 清晰度选择：先取主播放列表 */
  async pickQuality(item) {
    this.toast('正在获取清晰度…');
    try {
      const variants = await MS.hls.variants(MS.sniffer.effectiveUrl(item), { referer: MS.sites.referer() });
      if (!variants.length) {
        this.toast('没有找到可选清晰度', 'warn');
        return;
      }
      const chosen = await this.chooseDialog('选择清晰度', variants.map((v) => ({ label: v.label + (v.segments ? ' · ' + v.segments + ' 段' : ''), value: v.url })));
      if (!chosen) return;
      item.chosen = chosen;
      const v = variants.find((x) => x.url === chosen);
      this.toast('已选择：' + (v ? v.label : '自定义'));
      this.render();
    } catch (e) {
      this.toast('获取失败：' + e.message, 'warn');
    }
  },

  /** 简易单选对话框，返回选中的 value 或 null */
  chooseDialog(title, options) {
    return new Promise((resolve) => {
      const box = MS.dom.h('div.ms-box', MS.dom.h('h3', { text: title }));
      const close = (val) => {
        modal.remove();
        resolve(val);
      };
      for (const opt of options) {
        box.append(MS.dom.h('button.ms-btn', {
          style: { display: 'block', width: '100%', textAlign: 'left', marginBottom: '6px' },
          text: opt.label,
          onclick: () => close(opt.value),
        }));
      }
      box.append(MS.dom.h('div.ms-actions', MS.dom.h('button.ms-btn', { text: '取消', onclick: () => close(null) })));
      const modal = MS.dom.h('div.ms-modal', { onclick: (e) => { if (e.target === modal) close(null); } }, box);
      this.root.append(modal);
    });
  },

  settingsDialog() {
    const box = MS.dom.h('div.ms-box', MS.dom.h('h3', { text: '设置' }));
    const toggle = (label, key, hint) => {
      const input = MS.dom.h('input', {
        type: 'checkbox',
        name: 'ms-opt-' + key,
        'aria-label': label,
        checked: !!MS.conf[key],
        onchange: (e) => {
          MS.conf[key] = e.target.checked;
          MS.saveConf();
        },
      });
      box.append(MS.dom.h('div.ms-field', input, MS.dom.h('label', { text: label })));
      if (hint) box.append(MS.dom.h('div.ms-hint', { text: hint }));
    };

    toggle('直写磁盘（大文件更省内存，会弹出保存/选文件夹对话框）', 'streamToDisk');
    toggle('图片自动还原为原图', 'upgradeImage');
    toggle('显示头像 / 图标等装饰图', 'showDecor');
    toggle('页面切换（SPA）时清空列表', 'clearOnNav');
    toggle('嗅探到媒体时自动展开面板', 'autoOpenPanel');
    toggle('调试日志', 'debug');

    const conc = MS.dom.h('input', {
      type: 'number', name: 'ms-concurrency', 'aria-label': '分片并发数', min: 1, max: 8, value: MS.conf.concurrency,
      style: { width: '60px' },
      onchange: (e) => {
        MS.conf.concurrency = MS.util.clamp(Number(e.target.value) || 4, 1, 8);
        MS.saveConf();
      },
    });
    box.append(MS.dom.h('div.ms-field', MS.dom.h('label', { text: '分片并发数' }), conc));

    box.append(MS.dom.h('div.ms-hint', { text: '站点开关：关掉的站点不会自动显示悬浮球，仍可用 Alt+S 手动打开' }));
    for (const site of MS.sites.list) {
      const input = MS.dom.h('input', {
        type: 'checkbox',
        name: 'ms-site-' + site.id,
        'aria-label': '启用站点 ' + site.name,
        checked: MS.conf.siteEnabled[site.id] !== undefined ? !!MS.conf.siteEnabled[site.id] : !!MS.conf.siteEnabled.generic,
        onchange: (e) => {
          MS.conf.siteEnabled[site.id] = e.target.checked;
          MS.saveConf();
        },
      });
      box.append(MS.dom.h('div.ms-field', input, MS.dom.h('label', { text: site.name })));
    }
    box.append(MS.dom.h('div.ms-hint', { text: '版本 ' + MS.VERSION + ' · 嗅探到 ' + MS.sniffer.items.size + ' 条记录' }));
    box.append(MS.dom.h('div.ms-actions', MS.dom.h('button.ms-btn.ms-primary', { text: '关闭', onclick: () => modal.remove() })));
    const modal = MS.dom.h('div.ms-modal', { onclick: (e) => { if (e.target === modal) modal.remove(); } }, box);
    this.root.append(modal);
  },

  /* ---------------- 进度与提示 ---------------- */

  taskRow(task) {
    let row = this.taskEl.querySelector('[data-task="' + task.id + '"]');
    if (!row) {
      row = MS.dom.h('div.ms-task', { dataset: { task: String(task.id) } },
        MS.dom.h('div.ms-tname', MS.dom.h('span', { text: task.name }), MS.dom.h('span', { text: '' })),
        MS.dom.h('div.ms-track', MS.dom.h('div.ms-fill'))
      );
      this.taskEl.prepend(row);
    }
    const pct = task.total ? Math.min(100, (task.loaded / task.total) * 100) : task.status === 'done' ? 100 : 6;
    row.querySelector('.ms-fill').style.width = pct + '%';
    row.querySelector('.ms-tname span:last-child').textContent = task.status === 'error' ? '失败' : task.phase || '';
    row.classList.toggle('ms-error', task.status === 'error');
    row.classList.toggle('ms-done', task.status === 'done');
    if (task.status === 'error') {
      row.title = task.error || '';
      setTimeout(() => row.remove(), 12000);
    } else if (task.status === 'done') {
      setTimeout(() => row.remove(), 4000);
    }
  },

  toast(msg, type) {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.style.color = type === 'warn' ? 'var(--ms-warn)' : '';
    this.toastEl.classList.add('ms-show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.remove('ms-show'), 3200);
  },

  makeDraggable(panel, handle) {
    let startX = 0;
    let startY = 0;
    let originRect = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const rect = panel.getBoundingClientRect();
      originRect = rect;
      startX = e.clientX;
      startY = e.clientY;
      panel.style.left = rect.left + 'px';
      panel.style.top = rect.top + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const left = MS.util.clamp(originRect.left + (ev.clientX - startX), 4, window.innerWidth - 120);
        const top = MS.util.clamp(originRect.top + (ev.clientY - startY), 4, window.innerHeight - 60);
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        MS.store.set('panelPos', { left: panel.style.left, top: panel.style.top });
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    const pos = MS.store.get('panelPos', null);
    if (pos && pos.left) {
      panel.style.left = pos.left;
      panel.style.top = pos.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  },
};

/* ===== 80-boot.js ===== */
/* ============================================================
 * 80-boot —— 启动：站点识别、UI 挂载、菜单、SPA 监听、跨框架汇总
 * ============================================================ */

MS.boot = function () {
  MS.sites.init();
  MS.sniffer.start();
  MS.sites.scanDomHooked = false;
  // 方便在控制台调试：__MEDIA_SAVER__.sniffer.list()
  try {
    MS.page.__MEDIA_SAVER__ = MS;
  } catch (e) {
    /* 忽略 */
  }

  // 子框架：本帧不注入 UI，只把内容型媒体上报给顶层窗口
  if (window.top !== window.self) {
    MS.bus.on('media', (item) => {
      if (!['video', 'hls', 'image'].includes(item.kind)) return;
      try {
        window.top.postMessage(
          {
            __ms: 'media',
            url: MS.sniffer.effectiveUrl(item),
            kind: item.kind,
            contentType: item.contentType,
            size: item.size,
          },
          '*'
        );
      } catch (e) {
        /* 忽略 */
      }
    });
    return;
  }

  if (MS.sites.enabled()) MS.ui.mount(true);

  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || data.__ms !== 'media' || !data.url) return;
    const item = MS.sniffer.add(data.url, { source: 'frame', contentType: data.contentType, size: data.size, hint: 'content' });
    if (item) MS.util.log('来自内嵌框架的媒体', item);
  });

  registerMenus();
  watchNavigation();
  scheduleScan();
  MS.util.log(MS.NAME + ' v' + MS.VERSION + ' 已启动于', location.href);
};

/** 只扫 DOM 里的媒体元素（便宜，可高频调用） */
MS.sites.scanDom = function () {
  const push = (url, meta) => MS.sniffer.add(url, meta);
  let n = 0;
  for (const el of MS.dom.qsa('video, source, img')) {
    this.fromElement(el, push, n);
    n++;
    if (n > 800) break;
  }
  return n;
};

function registerMenus() {
  if (typeof GM_registerMenuCommand !== 'function') return;
  const guard = (fn) => () => {
    try {
      MS.ui.toggle(true);
      fn();
    } catch (e) {
      MS.ui.toast('出错：' + e.message, 'warn');
    }
  };
  GM_registerMenuCommand('打开/关闭面板（Alt+S）', () => MS.ui.toggle());
  GM_registerMenuCommand('重新扫描本页', guard(() => MS.ui.rescan()));
  GM_registerMenuCommand('下载本页所有视频', guard(() => MS.ui.downloadAll('video')));
  GM_registerMenuCommand('下载本页所有图片', guard(() => MS.ui.downloadAll('image')));
  GM_registerMenuCommand('清空已嗅探列表', () => MS.sniffer.clear());
  GM_registerMenuCommand('复制 TS→MP4 命令', () => copyRemuxCommand());
  GM_registerMenuCommand('设置', guard(() => MS.ui.settingsDialog()));
  GM_registerMenuCommand('导出调试信息', guard(() => exportDebug()));
}

/** 生成 ffmpeg 无损转封装命令（只做容器转换，不重新编码） */
function copyRemuxCommand() {
  const files = MS.store.get('lastTsFiles', []) || [];
  if (!files.length) {
    MS.ui.toast('还没有下载过 .ts 文件', 'warn');
    return;
  }
  const cmd = files
    .map((f) => 'ffmpeg -i ~/Downloads/"' + f + '" -c copy ~/Downloads/"' + f.replace(/\.ts$/i, '.mp4') + '"')
    .join('\n');
  MS.dl.copyText(cmd);
  MS.ui.toast('已复制 ' + files.length + ' 条转封装命令，粘贴到终端执行即可');
}

function exportDebug() {
  const list = MS.sniffer.list({ decor: true });
  const text = [
    MS.NAME + ' v' + MS.VERSION,
    '站点规则: ' + MS.sites.current.id + ' (' + MS.sites.current.name + ')',
    '地址: ' + location.href,
    'UA: ' + navigator.userAgent,
    '嗅探条目: ' + list.length,
    '',
    ...list.map((it) => [it.kind, it.ext, it.size || '', it.source, it.url].join(' | ')),
  ].join('\n');
  MS.dl.copyText(text);
  MS.ui.toast('调试信息已复制到剪贴板');
}

/** SPA 页面切换：清列表 + 重新扫描 */
function watchNavigation() {
  let last = location.href;
  const check = MS.util.debounce(() => {
    if (location.href === last) return;
    last = location.href;
    MS.util.log('页面切换 →', last);
    MS.sites.resetTitle();
    if (MS.conf.clearOnNav) MS.sniffer.clear();
    if (MS.ui.isOpen && MS.ui.isOpen()) MS.ui.render();
    MS.ui.updateFab && MS.ui.updateFab();
    setTimeout(() => {
      try {
        MS.sites.scanPage();
      } catch (e) {
        MS.util.warn(e);
      }
    }, 1200);
  }, 400);

  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  try {
    for (const method of ['pushState', 'replaceState']) {
      const orig = history[method];
      if (typeof orig !== 'function') continue;
      history[method] = function (...args) {
        const ret = orig.apply(this, args);
        setTimeout(check, 0);
        return ret;
      };
    }
  } catch (e) {
    /* 忽略 */
  }
  setInterval(check, 1500);
}

/** 首屏扫描 + 后续增量扫描 */
function scheduleScan() {
  const full = MS.util.debounce(() => {
    try {
      MS.sites.scanPage();
      MS.ui.updateFab && MS.ui.updateFab();
    } catch (e) {
      MS.util.warn('扫描失败', e);
    }
  }, 900);
  const dom = MS.util.debounce(() => {
    try {
      MS.sites.scanDom();
      MS.ui.updateFab && MS.ui.updateFab();
    } catch (e) {
      /* 忽略 */
    }
  }, 700);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(full, 500), { once: true });
  } else {
    setTimeout(full, 500);
  }
  window.addEventListener('load', () => setTimeout(full, 1500), { once: true });

  // DOM 变化（懒加载图集）→ 轻量扫描
  const observe = () => {
    if (!document.body || MS.sites.scanDomHooked) return;
    MS.sites.scanDomHooked = true;
    try {
      new MutationObserver(dom).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src', 'poster'] });
    } catch (e) {
      MS.util.warn('MutationObserver 不可用', e);
    }
  };
  if (document.body) observe();
  else document.addEventListener('DOMContentLoaded', observe, { once: true });

  // 兜底：视频开始播放时把真实地址捞进来
  window.addEventListener(
    'play',
    (e) => {
      const el = e.target;
      if (el && el.tagName === 'VIDEO') {
        const src = el.currentSrc || el.src;
        if (src) MS.sniffer.add(src, { source: 'dom:video-play', hint: 'content' });
      }
    },
    true
  );
}

try {
  MS.boot();
} catch (e) {
  console.error('[' + MS.NAME + '] 启动失败', e);
}

})();
