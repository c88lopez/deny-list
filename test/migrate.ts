import { execFileSync } from 'node:child_process';

// Vitest's globalSetup for the e2e tests: brings the test database's schema up
// to date before any test runs. Without TEST_DATABASE_URL the tests that need
// Postgres skip, so there's nothing to migrate.
export default function setup(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, MIGRATE_DATABASE_URL: url },
    stdio: 'inherit',
  });
}
