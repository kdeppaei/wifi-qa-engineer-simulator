import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { rollupOptions: { input: { lab: 'index.html', rvr: 'rvr-excel.html' } } },
  test: { include: ['src/**/*.test.ts'] },
});
