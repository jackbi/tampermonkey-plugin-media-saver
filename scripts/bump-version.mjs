#!/usr/bin/env node
/**
 * 版本号同步：package.json / 脚本头 @version / 代码里的 MS.VERSION 三处必须一致。
 * 用法：
 *   npm run bump 0.2.1   # 改成指定版本并重新构建
 *   npm run bump         # 以 package.json 为准，把另两处同步过去
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const pkgPath = join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const input = process.argv[2];

if (input && !SEMVER.test(input)) {
  console.error('版本号格式应为 x.y.z（例如 0.2.1），收到：' + input);
  process.exit(1);
}

const version = input || pkg.version;
if (!SEMVER.test(version)) {
  console.error('package.json 里的版本号不合法：' + version);
  process.exit(1);
}

const patch = (file, re, replacement) => {
  const path = join(root, file);
  const source = readFileSync(path, 'utf8');
  const next = source.replace(re, replacement);
  if (next === source) return false;
  writeFileSync(path, next);
  return true;
};

const changed = [
  patch('package.json', /"version":\s*"[^"]+"/, '"version": "' + version + '"') && 'package.json',
  patch('src/00-header.js', /^\/\/\s*@version\s+\S+/m, '// @version      ' + version) && 'src/00-header.js',
  patch('src/10-core.js', /VERSION:\s*'[^']+'/, "VERSION: '" + version + "'") && 'src/10-core.js',
].filter(Boolean);

console.log(changed.length ? '已更新：' + changed.join('、') : '三处版本号本来一致，无需改动');
execFileSync('node', [join(root, 'build.mjs')], { stdio: 'inherit' });

console.log('');
console.log('接下来：');
console.log('  1. 在 CHANGELOG.md 顶部补一条 ## ' + version + '（日期）');
console.log('  2. git add -A && git commit -m "chore: 发布 v' + version + '"');
console.log('  3. git tag -a v' + version + ' -m "v' + version + '" && git push origin main --follow-tags');
