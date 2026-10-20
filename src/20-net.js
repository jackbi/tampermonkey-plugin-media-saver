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
