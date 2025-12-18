import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  server: {
    port: 8006,
    cors: true,
    // 启用 HTTPS（使用 Vite 自动生成的自签名证书）
    // 如果遇到 WASM/Crypto 问题可以尝试启用
    // https: true
  },
  build: {
    target: 'esnext'
  }
});
