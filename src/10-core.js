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
