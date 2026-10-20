#!/usr/bin/env node
/**
 * 生成端到端测试素材到 /tmp/ms-fix（幂等：已齐全就跳过）。
 * 需要 ffmpeg；素材内容见 README「测试」一节。
 *
 * 端口 8731 与 test/run.mjs、test/serve.mjs 保持一致：
 * TS 播放列表里的密钥地址指向 http://127.0.0.1:8731/enc.key
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.MS_FIXTURE || '/tmp/ms-fix';
const PORT = 8731;
const REQUIRED = [
  'src.mp4',
  'enc.key',
  'master.m3u8',
  'index.html',
  'ts/index.m3u8',
  'ts/seg000.ts',
  'fmp4/index.m3u8',
  'fmp4/init.mp4',
  'fmp4/f000.m4s',
  'photo1.jpg',
  'photo2.jpg',
];

if (REQUIRED.every((f) => existsSync(join(DIR, f)))) {
  console.log('测试素材已存在，跳过生成：' + DIR);
  process.exit(0);
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch (e) {
  console.error('缺少 ffmpeg，无法生成测试素材。macOS 可执行：brew install ffmpeg');
  process.exit(1);
}

const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

mkdirSync(join(DIR, 'ts'), { recursive: true });
mkdirSync(join(DIR, 'fmp4'), { recursive: true });

// 5 秒测试视频：每秒一个关键帧，保证 HLS 切成多段
ffmpeg([
  '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=5',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-force_key_frames', 'expr:gte(t,n_forced*1)',
  '-c:a', 'aac', '-shortest', join(DIR, 'src.mp4'),
]);

// AES-128 加密的 TS 流（播放列表里的密钥地址指向本地测试服务）
writeFileSync(join(DIR, 'enc.key'), crypto.randomBytes(16));
writeFileSync(join(DIR, 'enc.keyinfo'), 'http://127.0.0.1:' + PORT + '/enc.key\n' + join(DIR, 'enc.key') + '\n');
ffmpeg([
  '-i', join(DIR, 'src.mp4'), '-c', 'copy',
  '-hls_time', '1', '-hls_playlist_type', 'vod',
  '-hls_key_info_file', join(DIR, 'enc.keyinfo'),
  '-hls_segment_filename', join(DIR, 'ts/seg%03d.ts'),
  join(DIR, 'ts/index.m3u8'),
]);

// fMP4 流（EXT-X-MAP + m4s 分片）
ffmpeg([
  '-i', join(DIR, 'src.mp4'), '-c', 'copy',
  '-hls_time', '1', '-hls_playlist_type', 'vod',
  '-hls_segment_type', 'fmp4',
  '-hls_fmp4_init_filename', 'init.mp4',
  '-hls_segment_filename', join(DIR, 'fmp4/f%03d.m4s'),
  join(DIR, 'fmp4/index.m3u8'),
]);

// 主播放列表：两档清晰度，测「自动选最高」
writeFileSync(
  join(DIR, 'master.m3u8'),
  '#EXTM3U\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=320x240\nfmp4/index.m3u8\n' +
    '#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=160x120\nts/index.m3u8\n'
);

// 用来测「拿到 HTML 而不是播放列表」的报错
writeFileSync(join(DIR, 'index.html'), 'not a playlist');

// 演示页用的两张图
ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=size=400x300:duration=1', '-frames:v', '1', join(DIR, 'photo1.jpg')]);
ffmpeg(['-f', 'lavfi', '-i', 'gradients=size=400x300:duration=1', '-frames:v', '1', join(DIR, 'photo2.jpg')]);

console.log('测试素材已生成：' + DIR);
