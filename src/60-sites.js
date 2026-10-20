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
