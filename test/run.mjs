#!/usr/bin/env node
/**
 * 端到端测试：用真实 HLS 素材（TS+AES-128 / fMP4）跑通
 * 嗅探判定 → 播放列表解析 → 分片下载 → 解密 → 顺序落盘 → ffprobe 校验
 *
 * 前置素材（/tmp/ms-fix）：
 *   ffmpeg -f lavfi -i "testsrc=size=320x240:rate=15:duration=5" -f lavfi -i "sine=frequency=440:duration=5" \
 *     -c:v libx264 -preset ultrafast -pix_fmt yuv420p -force_key_frames "expr:gte(t,n_forced*1)" -c:a aac -shortest src.mp4
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadUserscript, startServer, sha256 } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIX = process.env.MS_FIXTURE || '/tmp/ms-fix';
const OUT = '/tmp/ms-out';
const BASE = 'http://127.0.0.1:8731';
const FFPROBE = process.env.FFPROBE || '/opt/homebrew/bin/ffprobe';

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log('  \u2713 ' + name);
  } else {
    failed++;
    failures.push(name);
    console.log('  \u2717 ' + name + (extra ? '  -> ' + extra : ''));
  }
}

function eq(name, actual, expected) {
  ok(name, JSON.stringify(actual) === JSON.stringify(expected), 'actual=' + JSON.stringify(actual) + ' expected=' + JSON.stringify(expected));
}

function ffprobe(file) {
  const args = ['-v', 'error', '-show_entries', 'format=duration,format_name', '-show_entries', 'stream=codec_name,codec_type', '-of', 'json', file];
  return JSON.parse(execFileSync(FFPROBE, args, { encoding: 'utf8' }));
}

/** 组装一个可控的 document 替身，用于测试页面扫描 */
function makeDoc({ scripts = [], media = [] } = {}) {
  const scriptEls = scripts.map((text) => ({ textContent: text }));
  const mediaEls = media.map((m) => (m.raw ? m : {
    tagName: m.tagName,
    currentSrc: m.src,
    src: m.src,
    poster: m.poster,
    naturalWidth: m.width || 0,
    naturalHeight: m.height || 0,
    dataset: {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: m.width || 0, height: m.height || 0 }),
  }));
  return {
    title: '测试页面标题',
    body: { append() {}, addEventListener() {} },
    head: { append() {} },
    documentElement: { append() {} },
    createElement: () => ({ style: {}, append() {}, remove() {}, click() {}, setAttribute() {}, classList: { add() {}, toggle() {} }, querySelector: () => null, addEventListener() {}, dataset: {} }),
    querySelector: () => null,
    querySelectorAll: (sel) => (sel.includes('script') ? scriptEls : sel.includes('video') ? mediaEls : []),
    addEventListener() {},
    readyState: 'complete',
    execCommand: () => true,
  };
}

async function main() {
  if (!existsSync(join(FIX, 'src.mp4'))) throw new Error('缺少测试素材：' + FIX);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const server = await startServer(FIX, 8731);
  const MS = loadUserscript();
  MS.sites.init();

  console.log('\n[1] 站点识别与原图还原');
  eq('微博站规则命中', MS.sites.current.id, 'weibo');
  eq('微博缩略图 -> large', MS.sites.upgradeImage('https://wx1.sinaimg.cn/orj360/006APoFYly1.jpg'), 'https://wx1.sinaimg.cn/large/006APoFYly1.jpg');
  eq('微博 bmiddle -> large', MS.sites.upgradeImage('https://wx2.sinaimg.cn/bmiddle/abc123.jpg'), 'https://wx2.sinaimg.cn/large/abc123.jpg');
  const zhihu = MS.SITES.find((s) => s.id === 'zhihu');
  eq('知乎 _1440w 后缀 -> 原图', zhihu.upgradeImage('https://pic1.zhimg.com/80/v2-abc123_1440w.jpg?source=1'), 'https://pic1.zhimg.com/v2-abc123.jpg?source=1');
  const xhs = MS.SITES.find((s) => s.id === 'xiaohongshu');
  eq('小红书 !nd_dft 后缀 -> 原图', xhs.upgradeImage('https://sns-webpic-qc.xhscdn.com/2024/abc!nd_dft_wlteh_webp_3'), 'https://sns-webpic-qc.xhscdn.com/2024/abc');

  console.log('\n[2] 媒体类型判定与过滤');
  eq('m3u8 -> hls', MS.media.kindOf(BASE + '/ts/index.m3u8'), 'hls');
  eq('ts -> segment', MS.media.kindOf(BASE + '/ts/seg000.ts'), 'segment');
  eq('jpg -> image', MS.media.kindOf('https://wx1.sinaimg.cn/large/a.jpg'), 'image');
  eq('无后缀但类型为图片', MS.media.kindOf('https://sns-img-bd.xhscdn.com/abc123', 'image/jpeg'), 'image');
  eq('埋点域名被过滤', MS.sniffer.accept('https://www.google-analytics.com/collect?v=1'), false);
  eq('会话直播图被过滤', MS.sniffer.accept('https://cdn.example.com/a.js', 'application/javascript'), false);
  eq('头像被标为装饰图', MS.sniffer.relevanceOf('https://tvax1.sinaimg.cn/crop.0.0.996.996.180/abc.jpg'), 'decor');

  console.log('\n[3] 同一张图的不同尺寸只留一条');
  const s1 = MS.sniffer.add('https://wx1.sinaimg.cn/orj360/006APoFYly1.jpg', { source: 'test' });
  const s2 = MS.sniffer.add('https://wx1.sinaimg.cn/large/006APoFYly1.jpg', { source: 'test' });
  ok('两条记录合并', !!s1 && !!s2 && s1.id === s2.id, 'ids=' + (s1 && s1.id) + ',' + (s2 && s2.id));
  eq('列表长度', MS.sniffer.list().length, 1);
  eq('默认下载原图', MS.sniffer.effectiveUrl(s1), 'https://wx1.sinaimg.cn/large/006APoFYly1.jpg');
  s1.useOrigin = false;
  eq('可切回缩略图', MS.sniffer.effectiveUrl(s1), 'https://wx1.sinaimg.cn/orj360/006APoFYly1.jpg');
  MS.sniffer.clear();

  console.log('\n[4] HLS 播放列表解析');
  const master = MS.hls.parse('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240,CODECS="avc1.4d401f,mp4a.40.2"\nfmp4/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=160x120\nts/index.m3u8\n', BASE + '/master.m3u8');
  ok('识别为主播放列表', master.isMaster);
  eq('清晰度数量', master.variants.length, 2);
  eq('按清晰度降序', master.variants[0].url, BASE + '/fmp4/index.m3u8');
  eq('解析分辨率', master.variants[0].height, 240);
  eq('带逗号的 CODECS 不被截断', master.variants[0].codecs, 'avc1.4d401f,mp4a.40.2');

  const edge = MS.hls.parse([
    '#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-MEDIA-SEQUENCE:5',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0102030405060708090a0b0c0d0e0f10',
    '#EXTINF:4.0,', 'seg0.ts',
    '#EXT-X-BYTERANGE:1000@2000', '#EXTINF:4.0,', 'seg1.ts',
    '#EXT-X-KEY:METHOD=NONE', '#EXTINF:4.0,', 'seg2.ts', '#EXT-X-ENDLIST', '',
  ].join('\n'), 'https://cdn.example.com/a/b/index.m3u8');
  eq('分片数量', edge.segments.length, 3);
  eq('媒体序号起点', edge.segments[0].seq, 5);
  eq('相对地址解析', edge.segments[0].url, 'https://cdn.example.com/a/b/seg0.ts');
  eq('密钥地址解析', edge.segments[0].key.uri, 'https://cdn.example.com/a/b/key.bin');
  eq('IV 解析', [...edge.segments[0].key.iv], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  eq('BYTERANGE 解析', edge.segments[1].byterange, { length: 1000, offset: 2000 });
  ok('METHOD=NONE 后不再加密', edge.segments[2].key === null);
  eq('总时长', Math.round(edge.totalDuration), 12);
  eq('无 IV 时按序号推导', [...MS.hls.seqIv(258)], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  const pkcs = new Uint8Array(188 * 2 + 4);
  pkcs.fill(0x47, 0, 188 * 2);
  pkcs.fill(4, 188 * 2);
  eq('多余填充被剥掉', MS.hls.stripPadding(pkcs.buffer).byteLength, 376);

  console.log('\n[5] TS + AES-128 整条流下载（并发取片 + 顺序写入 + 解密）');
  const masterResolved = await MS.hls.prepare(BASE + '/master.m3u8', { referer: 'https://www.zhihu.com/' });
  eq('主列表自动选最高清晰度', masterResolved.ext, 'mp4');
  const tsPl = await MS.hls.prepare(BASE + '/ts/index.m3u8', { referer: 'https://www.zhihu.com/' });
  eq('TS 流容器判定', tsPl.ext, 'ts');
  eq('TS 分片数量', tsPl.segments.length, 5);
  ok('识别出 AES-128 加密', !!tsPl.key && tsPl.key.method === 'AES-128');
  const tsChunks = [];
  const resTs = await MS.hls.fetchAll(tsPl, {
    referer: 'https://www.zhihu.com/',
    name: 'hls-ts.ts',
    sink: { write: async (b) => tsChunks.push(Buffer.from(b)), close: async () => {} },
  });
  const tsBuf = Buffer.concat(tsChunks);
  writeFileSync(join(OUT, 'hls-ts.ts'), tsBuf);
  eq('写入字节数与统计一致', resTs.bytes, tsBuf.length);
  eq('解密后按 188 字节包对齐', tsBuf.length % 188, 0);
  eq('TS 包起始字节为 0x47', tsBuf[0], 0x47);
  const tsProbe = ffprobe(join(OUT, 'hls-ts.ts'));
  eq('ffprobe 识别时长 5 秒', Math.round(Number(tsProbe.format.duration)), 5);
  ok('含 h264 视频轨', tsProbe.streams.some((s) => s.codec_type === 'video' && s.codec_name === 'h264'));
  ok('含 aac 音频轨', tsProbe.streams.some((s) => s.codec_type === 'audio' && s.codec_name === 'aac'));
  const srcSize = readFileSync(join(FIX, 'src.mp4')).length;
  ok('拼接后体积与原片接近', Math.abs(tsBuf.length - srcSize) / srcSize < 0.4, tsBuf.length + ' vs ' + srcSize);

  console.log('\n[6] fMP4 整条流下载（init 段 + m4s）');
  const fmp4 = await MS.hls.prepare(BASE + '/fmp4/index.m3u8', { referer: 'https://www.xiaohongshu.com/' });
  eq('fMP4 容器判定', fmp4.ext, 'mp4');
  ok('带 init 段', !!fmp4.map && /init\.mp4$/.test(fmp4.map.uri));
  const mp4Chunks = [];
  const resMp4 = await MS.hls.fetchAll(fmp4, {
    referer: 'https://www.xiaohongshu.com/',
    name: 'hls-fmp4.mp4',
    sink: { write: async (b) => mp4Chunks.push(Buffer.from(b)), close: async () => {} },
  });
  const mp4Buf = Buffer.concat(mp4Chunks);
  writeFileSync(join(OUT, 'hls-fmp4.mp4'), mp4Buf);
  eq('写入字节数与统计一致', resMp4.bytes, mp4Buf.length);
  const mp4Probe = ffprobe(join(OUT, 'hls-fmp4.mp4'));
  eq('ffprobe 识别时长 5 秒', Math.round(Number(mp4Probe.format.duration)), 5);
  ok('产物是标准 mp4 容器', /mp4|mov/.test(mp4Probe.format.format_name), mp4Probe.format.format_name);

  console.log('\n[7] 直链视频：Range 分块直写磁盘');
  MS.dl.chunkSize = 16 * 1024;
  let rangeRequests = 0;
  const origGm = MS.__sandbox.GM_xmlhttpRequest;
  MS.__sandbox.GM_xmlhttpRequest = (opts) => {
    if (opts.headers && opts.headers.Range) rangeRequests++;
    if (opts.headers && opts.headers.Range) MS.__sandbox.__lastRangeHeaders = opts.headers;
    return origGm(opts);
  };
  const dlChunks = [];
  const resDirect = await MS.dl.single(BASE + '/src.mp4', {
    referer: 'https://www.weibo.com/',
    name: 'direct.mp4',
    sink: { write: async (b) => dlChunks.push(Buffer.from(b)), close: async () => {} },
  });
  ok('走了多次分块请求', rangeRequests > 3, 'rangeRequests=' + rangeRequests);
  eq('返回字节数正确', resDirect.bytes, srcSize);
  const directBuf = Buffer.concat(dlChunks);
  eq('分块拼接后的体积与原文件一致', directBuf.length, srcSize);
  ok('分块拼接后逐字节一致', sha256(directBuf) === sha256(readFileSync(join(FIX, 'src.mp4'))));
  eq('分块请求带上了防盗链 Referer', MS.__sandbox.__lastRangeHeaders && MS.__sandbox.__lastRangeHeaders.Referer, 'https://www.weibo.com/');
  const lastStart = Math.floor((srcSize - 1) / (16 * 1024)) * (16 * 1024);
  eq('最后一段 Range 请求覆盖到文件末尾', MS.__sandbox.__lastRangeHeaders && MS.__sandbox.__lastRangeHeaders.Range, 'bytes=' + lastStart + '-' + (srcSize - 1));

  console.log('\n[8] 直链视频：内存模式（用户拒绝磁盘写入权限时）');
  const resMem = await MS.dl.single(BASE + '/src.mp4', { referer: 'https://www.weibo.com/', name: 'memory.mp4' });
  const blob = [...MS.__sandbox.__blobs.values()][0];
  ok('产出了待保存的 Blob', !!blob);
  ok('Blob 内容与原文件一致', !!blob && sha256(Buffer.from(await blob.arrayBuffer())) === sha256(readFileSync(join(FIX, 'src.mp4'))));
  eq('返回字节数正确', resMem.bytes, srcSize);

  console.log('\n[9] 文件名模板');
  MS.conf.naming = '{site}-{title}-{index}';
  eq('渲染站点/标题/序号', MS.dl.fileName({ kind: 'video', ext: 'mp4', host: 'f.video.weibocdn.com' }, 3), '微博-测试页面标题-03.mp4');
  eq('m3u8 不会成为文件后缀', MS.dl.fileName({ kind: 'hls', ext: 'm3u8', host: 'cdn' }, 1, { ext: 'mp4' }), '微博-测试页面标题-01.mp4');
  eq('扩展名可用 {ext} 变量', MS.dl.fileName({ kind: 'image', ext: 'jpg', host: 'h' }, 1, { ext: 'png' }), '微博-测试页面标题-01.png');
  ok('非法字符被清理', !/[<>:"/\\|?*]/.test(MS.util.sanitize('a/b:c*d?e"f<g>h|i')));
  eq('空标题有兜底', MS.util.sanitize('   '), 'untitled');
  eq('体积格式化', MS.util.fmtBytes(1536), '1.5 KB');
  eq('类型标签', MS.media.kindLabel('hls'), 'HLS 流');

  console.log('\n[10] 异常场景');
  let err = '';
  try {
    await MS.hls.decrypt(new Uint8Array(32), { method: 'SAMPLE-AES', uri: 'https://x/y' }, { seq: 0 }, new Map(), '');
  } catch (e) {
    err = e.message;
  }
  ok('SAMPLE-AES / DRM 明确报错', /SAMPLE-AES/.test(err), err);
  err = '';
  try {
    await MS.hls.load(BASE + '/index.html', {});
  } catch (e) {
    err = e.message;
  }
  ok('拿到 HTML 时给出可读错误', err.length > 0, err);
  const emptyPl = MS.hls.parse('#EXTM3U\n', BASE + '/x.m3u8');
  eq('空播放列表没有分片', emptyPl.segments.length, 0);

  console.log('\n[11] 页面内嵌数据扫描：小红书');
  const xhsMS = loadUserscript({
    location: { href: 'https://www.xiaohongshu.com/explore/abc123', hostname: 'www.xiaohongshu.com', origin: 'https://www.xiaohongshu.com', protocol: 'https:' },
    document: makeDoc(),
    __INITIAL_STATE__: {
      note: {
        noteDetailMap: {
          abc123: {
            note: {
              title: '测试笔记',
              imageList: [
                { urlDefault: 'https://sns-webpic-qc.xhscdn.com/202401/aaa!nd_dft_wgth_webp_3', urlPre: 'https://sns-webpic-qc.xhscdn.com/202401/aaa!nd_prv_wlteh_webp_3' },
                { urlDefault: 'https://sns-webpic-qc.xhscdn.com/202401/bbb!nd_dft_wgth_webp_3' },
              ],
              video: { media: { stream: { h264: [{ masterUrl: 'https://sns-video-bd.xhscdn.com/stream/110/xyz.mp4' }] } } },
            },
          },
        },
      },
    },
  });
  xhsMS.sites.init();
  eq('站点识别为小红书', xhsMS.sites.current.id, 'xiaohongshu');
  xhsMS.sites.scanPage();
  const xhsList = xhsMS.sniffer.list();
  eq('同图的 urlPre / urlDefault 只留一条', xhsList.filter((i) => i.kind === 'image').length, 2);
  eq('视频被识别出来', xhsList.filter((i) => i.kind === 'video').length, 1);
  eq('图片按原图地址去重', xhsList.find((i) => i.kind === 'image').key, 'https://sns-webpic-qc.xhscdn.com/202401/aaa');
  ok('下载地址用的是原图', xhsMS.sniffer.effectiveUrl(xhsList.find((i) => i.kind === 'image')) === 'https://sns-webpic-qc.xhscdn.com/202401/aaa');

  console.log('\n[12] 页面内嵌数据扫描：微博图集 / 知乎视频');
  const weiboMS = loadUserscript({
    location: { href: 'https://weibo.com/u/1234567890', hostname: 'weibo.com', origin: 'https://weibo.com', protocol: 'https:' },
    document: makeDoc({
      scripts: ['<script>FM.view({"pic_ids":["006APoFYly1gabcdefghi","006APoFYly1gabcdefghj"]})</script>'],
      media: [
        { tagName: 'VIDEO', src: 'https://f.video.weibocdn.com/o0/demo.mp4?label=mp4_720p&token=abc' },
        { tagName: 'IMG', src: 'https://wx1.sinaimg.cn/orj360/006APoFYly1gabcdefghk.jpg', width: 480, height: 640 },
        { tagName: 'IMG', src: 'https://tvax1.sinaimg.cn/crop.0.0.996.996.180/avatar123.jpg', width: 40, height: 40 },
      ],
    }),
  });
  weiboMS.sites.init();
  weiboMS.sites.scanPage();
  const wbList = weiboMS.sniffer.list();
  const wbDecor = weiboMS.sniffer.list({ decor: true });
  eq('内联 JSON 里的 pic_ids 被还原成图片地址', wbList.filter((i) => i.kind === 'image').length, 3);
  eq('无后缀的小头像被识别为图片类型', weiboMS.media.kindOf('https://tvax1.sinaimg.cn/crop.0.0.996.996.180/avatar123.jpg'), 'image');
  eq('视频被识别出来', wbList.filter((i) => i.kind === 'video').length, 1);
  eq('40px 头像归为装饰图，默认不显示', wbDecor.length - wbList.length, 1);
  const domImg = wbList.find((i) => i.url === 'https://wx1.sinaimg.cn/orj360/006APoFYly1gabcdefghk.jpg');
  ok('保留了页面里的原始请求地址', !!domImg);
  eq('同时给出可下载的原图地址', domImg && domImg.originUrl, 'https://wx1.sinaimg.cn/large/006APoFYly1gabcdefghk.jpg');
  eq('默认按原图下载', domImg && weiboMS.sniffer.effectiveUrl(domImg), 'https://wx1.sinaimg.cn/large/006APoFYly1gabcdefghk.jpg');

  // 同源多清晰度合并
  const merged = weiboMS.sites.collapseVariants([
    { id: 1, kind: 'video', url: 'https://f.video.weibocdn.com/o0/demo.mp4?label=mp4_720p', ext: 'mp4', host: 'f.video.weibocdn.com' },
    { id: 2, kind: 'video', url: 'https://f.video.weibocdn.com/o0/demo.mp4?label=mp4_1080p', ext: 'mp4', host: 'f.video.weibocdn.com' },
  ]);
  eq('同一视频的多清晰度合并为一条', merged.length, 1);
  eq('默认选最高清晰度', merged[0].chosen, 'https://f.video.weibocdn.com/o0/demo.mp4?label=mp4_1080p');
  eq('清晰度名称解析', merged[0].variants.map((v) => v.quality.name), ['1080p', '720p']);

  console.log('\n[13] 兜底方案：站点只暴露分片、没有 m3u8 时按目录合并');
  MS.sniffer.clear();
  for (const n of [0, 1, 2, 3, 4]) MS.sniffer.add(BASE + '/fmp4/f' + String(n).padStart(3, '0') + '.m4s', { source: 'test', contentType: 'video/iso.segment' });
  MS.sniffer.add(BASE + '/fmp4/init.mp4', { source: 'test', contentType: 'video/mp4' });
  const groups = MS.media.groupSegments(MS.sniffer.list({ decor: true }));
  eq('分片被归到同一组', groups.length, 1);
  eq('组内分片数量', groups[0].items.length, 5);
  eq('分片按序号排序', groups[0].items.map((i) => i.url.slice(-8)), ['f000.m4s', 'f001.m4s', 'f002.m4s', 'f003.m4s', 'f004.m4s']);
  const mergedChunks = [];
  const mergeRes = await MS.dl.mergeSegments(groups[0], {
    referer: 'https://www.xiaohongshu.com/',
    name: 'merged.mp4',
    parts: [],
    task: MS.dl.newTask('merged.mp4'),
    sink: { write: async (b) => mergedChunks.push(Buffer.from(b)), close: async () => {} },
  });
  const mergedBuf = Buffer.concat(mergedChunks);
  writeFileSync(join(OUT, 'merged-from-segments.mp4'), mergedBuf);
  eq('自动补上 init 段并合并 5 个分片', mergedBuf.length, mp4Buf.length);
  ok('合并结果与正常 HLS 下载逐字节一致', sha256(mergedBuf) === sha256(mp4Buf));
  ok('合并结果可播放', Math.round(Number(ffprobe(join(OUT, 'merged-from-segments.mp4')).format.duration)) === 5);
  void mergeRes;

  console.log('\n[14] CDN 因 Referer 拒绝时的退路');
  let gmCalls = 0;
  const gmBackup = MS.__sandbox.GM_xmlhttpRequest;
  MS.__sandbox.GM_xmlhttpRequest = (opts) => {
    gmCalls++;
    opts.onload({ status: 403, responseHeaders: 'content-type: text/plain', response: 'forbidden', finalUrl: opts.url });
  };
  const retry = await MS.net.request({ url: BASE + '/src.mp4', referer: 'https://www.xiaohongshu.com/' });
  eq('GM 被拒后改走页面内 fetch 并成功', retry.status, 200);
  eq('没有反复重试 GM', gmCalls, 1);
  const noRetry = await MS.net.request({ url: BASE + '/src.mp4', noPageFallback: true }).then((r) => r.status, (e) => e.message);
  eq('禁用退路时如实返回 403', noRetry, 403);
  MS.__sandbox.GM_xmlhttpRequest = gmBackup;

  console.log('\n[15] 视频身份识别：作者 / 文案 / 封面 / 页面顺序');
  const authorEl = { textContent: '张三' };
  const textEl = { textContent: '今天的晚饭真好吃，做了两个小时' };
  const cardEl = {
    tagName: 'DIV',
    innerText: '张三 今天的晚饭真好吃，做了两个小时',
    textContent: '张三 今天的晚饭真好吃，做了两个小时',
    parentElement: null,
    querySelector: (sel) =>
      sel.startsWith('a[href*="/u/"]') ? authorEl : sel.includes('note-text') ? textEl : null,
  };
  const domVideo = {
    raw: true,
    tagName: 'VIDEO',
    src: 'https://f.video.weibocdn.com/o0/domvideo.mp4',
    currentSrc: 'https://f.video.weibocdn.com/o0/domvideo.mp4',
    poster: 'https://wx1.sinaimg.cn/large/cover2.jpg',
    parentElement: cardEl,
    dataset: {},
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 320, height: 240 }),
  };
  const ctxMS = loadUserscript({
    location: { href: 'https://weibo.com/u/1234567890', hostname: 'weibo.com', origin: 'https://weibo.com', protocol: 'https:' },
    document: makeDoc({ media: [domVideo] }),
    $render_data: {
      status: {
        text_raw: '今天的晚饭&nbsp;<a href="/u/1">@某人</a>',
        user: { screen_name: '张三' },
        page_info: {
          type: 'video',
          page_pic: 'https://wx1.sinaimg.cn/large/cover1.jpg',
          media_info: {
            title: '自制糖醋排骨',
            playback_list: [
              { play_info: { url: 'https://f.video.weibocdn.com/o0/jsonvideo.mp4?label=mp4_720p' } },
              { play_info: { url: 'https://f.video.weibocdn.com/o0/jsonvideo.mp4?label=mp4_1080p' } },
            ],
          },
        },
      },
    },
  });
  ctxMS.sites.init();
  ctxMS.sites.scanPage();
  const allVideos = ctxMS.sniffer.list().filter((i) => i.kind === 'video');
  eq('页面上识别出 3 个视频地址（含两档清晰度）', allVideos.length, 3);
  const jsonVideo = allVideos.find((i) => i.url.includes('jsonvideo'));
  eq('内嵌数据里的视频拿到了文案标题', jsonVideo.title, '自制糖醋排骨');
  eq('也拿到了作者', jsonVideo.author, '张三');
  eq('拿到了封面图', jsonVideo.poster, 'https://wx1.sinaimg.cn/large/cover1.jpg');
  const domVideoItem = allVideos.find((i) => i.url.includes('domvideo'));
  eq('DOM 里的视频从所在卡片抠出文案', domVideoItem.title, '今天的晚饭真好吃，做了两个小时');
  eq('也抠出了作者', domVideoItem.author, '张三');
  eq('用 video 标签的 poster 当封面', domVideoItem.poster, 'https://wx1.sinaimg.cn/large/cover2.jpg');
  eq('页面里的视频排在只嗅探到地址的前面', ctxMS.sniffer.list().find((i) => i.kind === 'video').url.includes('domvideo'), true);
  const collapsed = ctxMS.sites.collapseVariants(allVideos);
  const mergedVideos = collapsed.filter((i) => i.kind === 'video');
  eq('多档清晰度合并成一条', mergedVideos.length, 2);
  const withVariants = mergedVideos.find((i) => i.variants);
  eq('可选清晰度', withVariants.variants.map((v) => v.quality.name), ['1080p', '720p']);
  eq('默认最高清晰度', withVariants.chosen.includes('1080p'), true);
  eq('合并后仍保留身份信息', withVariants.title, '自制糖醋排骨');
  eq('正文 HTML 被清理成纯文本', ctxMS.util.cleanText('今天的晚饭&nbsp;<a href="/u/1">@某人</a>'), '今天的晚饭 @某人');
  eq('超长文案截断', ctxMS.util.cleanText('啊'.repeat(100), 10).length, 10);
  const notMerged = ctxMS.sites.collapseVariants([
    { id: 91, kind: 'video', url: 'https://cdn.example.com/a/v.mp4?take=2', ext: 'mp4', host: 'cdn.example.com' },
    { id: 92, kind: 'video', url: 'https://cdn.example.com/a/v.mp4?take=3', ext: 'mp4', host: 'cdn.example.com' },
  ]);
  eq('路径相同但看不出清晰度的地址不会被误合并', notMerged.length, 2);

  console.log('\n[16] 脚本元数据');
  const built = readFileSync(join(root, 'dist/media-saver.user.js'), 'utf8');
  const header = built.split('==/UserScript==')[0];
  const matches = [...header.matchAll(/^\/\/\s*@match\s+(\S+)/gm)].map((m) => m[1]);
  eq('只在这三个站点加载', matches, ['*://*.weibo.com/*', '*://*.weibo.cn/*', '*://*.zhihu.com/*', '*://*.xiaohongshu.com/*']);
  ok('作者已改为 wayne', /@author\s+wayne\b/.test(header));
  ok('不再有 @connect *', !/@connect\s+\*/.test(header));
  ok('版本号与脚本内一致', new RegExp('@version\\s+' + MS.VERSION.replace(/\./g, '\\.')).test(header), MS.VERSION);
  ok('保留 document-start（挂钩请求需要）', /@run-at\s+document-start/.test(header));

  // 按 Chrome match pattern 的语义校验：协议 / 主机（*. 含裸域）/ 路径
  const matchesUrl = (pattern, url) => {
    const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!m) return false;
    const u = new URL(url);
    if (m[1] !== '*' && m[1] + ':' !== u.protocol) return false;
    const host = m[2];
    const hostOk = host.startsWith('*.')
      ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1))
      : u.hostname === host;
    return hostOk && m[3] === '/*';
  };
  const hit = (url) => matches.find((p) => matchesUrl(p, url));
  ok('微博桌面页命中', !!hit('https://weibo.com/u/1234567890'));
  ok('微博移动页命中', !!hit('https://m.weibo.cn/detail/123'));
  ok('知乎专栏命中', !!hit('https://zhuanlan.zhihu.com/p/123456'));
  ok('小红书笔记页命中', !!hit('https://www.xiaohongshu.com/explore/abc'));
  ok('普通网站不命中', !hit('https://example.com/'));
  ok('仿冒域名不命中', !hit('https://zhihu.com.evil.com/x') && !hit('https://fakeweibo.com/x'));

  server.close();
  console.log('\n通过 ' + passed + ' 项，失败 ' + failed + ' 项');
  if (failed) {
    console.log('失败清单:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log('产物目录：' + OUT);
  process.exit(0);
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exit(1);
});
