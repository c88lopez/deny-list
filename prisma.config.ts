import { defineConfig } from 'prisma/config';

// Only the CLI reads this. Migrations go straight to Postgres
// (MIGRATE_DATABASE_URL, postgres-rw), not through PgBouncer: migrate takes a
// session advisory lock, which transaction mode can't hold.
//
// process.env rather than env(): env() throws when the variable is unset, and
// `prisma generate` (npm ci's postinstall, in CI and the Docker build) runs
// without it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.MIGRATE_DATABASE_URL },
});
