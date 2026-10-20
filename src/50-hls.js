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
