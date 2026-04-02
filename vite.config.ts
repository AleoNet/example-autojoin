import { defineConfig } from 'vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  optimizeDeps: {
    exclude: ['@provablehq/sdk/testnet', '@provablehq/sdk/mainnet'],
  },
  server: {
    proxy: {
      '/provable-api': {
        target: 'https://api.provable.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/provable-api/, ''),
      }
    }
  }
});
