import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  const buildCommit = env.VITE_BUILD_COMMIT ?? env.GITHUB_SHA ?? 'local';
  return {
    base: '/wanawana/',
    define: {
      'import.meta.env.VITE_BUILD_COMMIT': JSON.stringify(buildCommit),
    },
    build: {
      target: 'es2022',
      sourcemap: false,
      manifest: 'manifest.json',
    },
  };
});
