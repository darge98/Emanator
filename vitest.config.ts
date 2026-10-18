import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/apps/*/src/**/*.test.ts', 'src/modules/*/src/**/*.test.ts'],
  },
});
