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
