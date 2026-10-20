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
