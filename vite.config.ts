import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GROWI script プラグインのビルド設定。
// manifest: true で dist/manifest.json を生成する。
// GROWI はこの manifest を参照して注入すべきスクリプトを解決するため必須。
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rollupOptions: {
      input: ['/src/client-entry.tsx'],
    },
  },
});
