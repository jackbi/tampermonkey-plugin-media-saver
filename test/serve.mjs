#!/usr/bin/env node
/**
 * 浏览器冒烟测试用的静态服务：
 *   /media-saver.user.js  → 仓库 dist/
 *   /demo.html            → test/fixtures/
 *   其它（src.mp4、ts/、fmp4/、master.m3u8、图片）→ /tmp/ms-fix（测试素材目录）
 *
 * 用法：node test/serve.mjs [端口]   然后浏览器打开 http://127.0.0.1:8731/demo.html
 */
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.env.MS_FIXTURE || '/tmp/ms-fix';
const PORT = Number(process.argv[2]) || 8731;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.ts': 'video/mp2t',
  '.key': 'application/octet-stream',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** 路由：先看仓库内的虚拟路径，再回落到素材目录 */
function resolve(pathname) {
  if (pathname === '/' || pathname === '/demo.html') return join(root, 'test/fixtures/demo.html');
  if (pathname === '/media-saver.user.js' || pathname === '/demo-remote.user.js') return join(root, 'dist/media-saver.user.js');
  const file = join(FIX, pathname);
  if (!file.startsWith(FIX) || !existsSync(file) || statSync(file).isDirectory()) return null;
  return file;
}

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = resolve(pathname);
    if (!file || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 ' + pathname);
      return;
    }
    const stat = statSync(file);
    const headers = {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    if (req.method === 'HEAD') {
      res.writeHead(200, headers).end();
      return;
    }
    res.writeHead(200, headers);
    createReadStream(file).pipe(res);
  })
  .listen(PORT, '127.0.0.1', () => {
    console.log('演示页: http://127.0.0.1:' + PORT + '/demo.html');
    console.log('素材目录: ' + FIX);
  });
