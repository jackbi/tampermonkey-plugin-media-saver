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
