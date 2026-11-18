import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/migrate.ts'],
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/generated/**'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportsDirectory: 'coverage/e2e',
    },
  },
});
