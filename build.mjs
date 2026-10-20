#!/usr/bin/env node
/**
 * 无依赖打包：把 src/*.js 按文件名顺序拼接成一个 .user.js
 * 00-header.js 是 UserScript 元数据块，必须位于文件最前面
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const outDir = join(root, 'dist');
const outFile = join(outDir, 'media-saver.user.js');

const files = readdirSync(srcDir)
  .filter((f) => f.endsWith('.js'))
  .sort();

const header = files.find((f) => f.startsWith('00-'));
if (!header) throw new Error('缺少 src/00-header.js（UserScript 元数据）');

const body = files.filter((f) => f !== header);
const banner = [
  '',
  '/*!',
  ' * 由 build.mjs 自动生成，请勿直接修改本文件。',
  ' * 源码在 src/ 目录，改完执行：node build.mjs',
  ' * 版本以 00-header.js 里的 @version 为准。',
  ' */',
  '',
].join('\n');

const code = body
  .map((f) => '/* ===== ' + f + ' ===== */\n' + readFileSync(join(srcDir, f), 'utf8').trimEnd())
  .join('\n\n');

const out = readFileSync(join(srcDir, header), 'utf8').trimEnd() + '\n' + banner + "(function () {\n'use strict';\n\n" + code + '\n\n})();\n';

mkdirSync(outDir, { recursive: true });
writeFileSync(outFile, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log('已生成 ' + outFile.replace(root + '/', '') + '（' + files.length + ' 个模块，' + kb + ' KB）');
