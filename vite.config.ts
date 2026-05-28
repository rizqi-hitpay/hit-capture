import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  worker: {
    format: 'es',
  },
  build: {
    target: 'chrome121',
    minify: true,
    rollupOptions: {
      input: {
        editor: 'src/editor/editor.html',
        popup: 'src/popup/popup.html',
        offscreen: 'src/offscreen/offscreen.html',
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
});
