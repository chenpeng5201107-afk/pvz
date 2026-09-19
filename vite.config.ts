import { defineConfig } from 'vite';
import ts from 'typescript';
import { minify } from 'terser';

export default defineConfig({
  resolve: { preserveSymlinks: true },
  // In-process transpilation also works in environments that restrict child processes.
  esbuild: false,
  plugins: [
    {
      name: 'typescript-in-process',
      enforce: 'pre',
      transform(code: string, id: string) {
        if (!id.split('?')[0]!.endsWith('.ts')) return;
        const result = ts.transpileModule(code, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            sourceMap: true,
          },
          fileName: id,
        });
        return {
          code: result.outputText,
          map: result.sourceMapText ? JSON.parse(result.sourceMapText) : null,
        };
      },
    },
    {
      name: 'minify-in-process',
      apply: 'build',
      async renderChunk(code) {
        const result = await minify(code, {
          module: true,
          compress: { passes: 1 },
          mangle: true,
          format: { comments: false },
        });
        return { code: result.code!, map: null };
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
  build: {
    target: 'es2022',
    minify: false,
    chunkSizeWarningLimit: 7000,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
  },
});
