import { defineConfig } from 'vite';

export default defineConfig({
  base: '/wanawana/',
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
