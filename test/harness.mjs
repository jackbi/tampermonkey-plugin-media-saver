/**
 * 在 Node 里加载 src/*.js（跳过启动逻辑），提供最小化的浏览器环境替身。
 * 网络统一走 GM_xmlhttpRequest 替身 → 本地 HTTP 服务器。
 */
import { readFileSync, readdirSync, createReadStream, statSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import http from 'node:http';
import crypto from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.key': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.html': 'text/html',
};

/** 本地静态服务器，支持 Range（用于验证分块下载） */
export function startServer(staticRoot, port = 8731) {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = join(staticRoot, pathname);
    if (!file.startsWith(staticRoot) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    const stat = statSync(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : stat.size - 1;
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': end - start + 1,
        'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size,
        'Accept-Ranges': 'bytes',
      });
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    const headers = { 'Content-Type': type, 'Content-Length': stat.size, 'Accept-Ranges': 'bytes' };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers).end();
      return;
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

function fakeEl(tag = 'div') {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    href: '',
    download: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    append(...kids) {
      this.children.push(...kids);
    },
    remove() {},
    click() {},
    setAttribute() {},
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
    addEventListener() {},
    closest: () => null,
  };
}

/** 加载 src/*.js（不含元数据与启动模块），返回 MS 命名空间 */
export function loadUserscript(overrides = {}) {
  const srcDir = join(root, 'src');
  const files = readdirSync(srcDir)
    .filter((f) => f.endsWith('.js') && !f.startsWith('00-') && !f.startsWith('80-'))
    .sort();
  const code = files.map((f) => readFileSync(join(srcDir, f), 'utf8')).join('\n');
  const created = new Map();

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    crypto,
    Blob,
    TextEncoder,
    TextDecoder,
    ArrayBuffer,
    Uint8Array,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: (...args) => fetch(...args),
    URL,
    location: {
      href: 'https://www.weibo.com/u/1234567890',
      hostname: 'www.weibo.com',
      origin: 'https://www.weibo.com',
      protocol: 'https:',
    },
    navigator: { userAgent: 'node-harness' },
    performance: { getEntriesByType: () => [] },
    document: {
      title: '测试页面标题',
      body: fakeEl('body'),
      head: fakeEl('head'),
      documentElement: fakeEl('html'),
      createElement: (t) => fakeEl(t),
      createTextNode: (t) => ({ text: t }),
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      removeEventListener() {},
      readyState: 'complete',
      execCommand: () => true,
    },
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.globalThis = sandbox;

  class TestURL extends URL {
    static createObjectURL(blob) {
      const url = 'blob:node/' + Math.random().toString(36).slice(2);
      created.set(url, blob);
      return url;
    }

    static revokeObjectURL(url) {
      created.delete(url);
    }
  }
  sandbox.URL = TestURL;
  sandbox.__blobs = created;

  sandbox.GM_xmlhttpRequest = (opts) => {
    fetch(opts.url, { method: opts.method || 'GET', headers: Object.assign({}, opts.headers || {}) })
      .then(async (res) => {
        const response = opts.responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
        opts.onload({
          status: res.status,
          responseHeaders: [...res.headers.entries()].map(([k, v]) => k + ': ' + v).join('\r\n'),
          response,
          finalUrl: res.url,
        });
      })
      .catch((e) => opts.onerror && opts.onerror({ error: e.message }));
  };
  sandbox.__store = {};
  sandbox.GM_getValue = (key, def) => (key in sandbox.__store ? sandbox.__store[key] : def);
  sandbox.GM_setValue = (key, val) => {
    sandbox.__store[key] = val;
  };
  for (const name of ['GM_addStyle', 'GM_download', 'GM_setClipboard', 'GM_notification', 'GM_registerMenuCommand']) {
    if (!(name in overrides)) sandbox[name] = () => undefined;
  }

  const context = vm.createContext(sandbox);
  const MS = new vm.Script('(function () { "use strict";\n' + code + '\n; return MS; })()').runInContext(context);
  MS.__sandbox = sandbox;
  return MS;
}

export function sha256(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return crypto.createHash('sha256').update(buf).digest('hex');
}
