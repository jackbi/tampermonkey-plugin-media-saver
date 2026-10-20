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
