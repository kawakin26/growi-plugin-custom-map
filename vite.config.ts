import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GROWI script プラグインのビルド設定。
// manifest: true で dist/manifest.json を生成する。
// GROWI はこの manifest の "client-entry.tsx" エントリを参照して
// 注入すべきスクリプトを解決するため、エントリはリポジトリ直下に置く。
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: ['/client-entry.tsx'],
    },
  },
});
