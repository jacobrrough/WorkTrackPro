import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
    // This worktree is nested inside the main checkout, so without dedupe Vitest
    // can resolve a second copy of React (one here, one in the parent
    // node_modules), which triggers "invalid hook call" in component tests.
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    // Pin collection to this worktree so the parent checkout's tests/sources
    // (one directory up) can never be collected alongside ours. With root
    // anchored here, the relative globs below cannot reach the parent tree.
    root: __dirname,
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'netlify/**/*.{test,spec}.{ts,tsx}'],
  },
});
