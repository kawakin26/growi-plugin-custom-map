import { copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Vite 5 は manifest を dist/.vite/manifest.json に出力する。
// GROWI のバージョンによっては dist/manifest.json を参照するため、
// 両方の場所に存在するようコピーしておく（どちらを読んでも解決できるようにする）。
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const viteManifest = resolve(root, 'dist/.vite/manifest.json');
const legacyManifest = resolve(root, 'dist/manifest.json');

if (existsSync(viteManifest)) {
  copyFileSync(viteManifest, legacyManifest);
  console.log('[copy-manifest] dist/manifest.json を生成しました');
} else {
  console.warn('[copy-manifest] dist/.vite/manifest.json が見つかりません');
}
