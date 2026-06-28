import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `@` resolves to apps/web/src so route handlers that import `@/lib/auth`,
// `@/app/api/utils/sql`, etc. load (and can be mocked) the same way they do at runtime.
const srcDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  test: {
    environment: 'node',
    setupFiles: [],
    include: ['**/*.test.ts'],
  },
});
