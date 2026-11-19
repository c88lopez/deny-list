import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PRISMA } from '../database/database.module.js';
import type { Entry, PrismaClient } from '../generated/prisma/client.js';
import { REDIS } from '../redis/redis.module.js';
import type { EntryKey } from './entry.js';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// One Redis set per type, holding the values: entries:ip, entries:email, ...
export function redisKey(type: EntryKey['type']): string {
  return `entries:${type}`;
}

// Postgres is the source of truth; Redis holds a copy that GET reads alone.
// POST and DELETE write both, Redis inside the Postgres transaction and under
// a lock on the entry, so concurrent writes to one entry reach Redis in the
// order they commit, and a Redis failure rolls the Postgres change back.
@Injectable()
export class EntriesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient | null,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  // The entry, and whether this call created it. Adding one that's already
  // there isn't an error: it returns the existing row, and still writes it to
  // Redis in case it was missing there.
  async add(key: EntryKey): Promise<{ entry: Entry; created: boolean }> {
    const redis = this.cache();

    return this.locked(key, async (tx) => {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING: a row only if inserted.
      // Under the lock no DELETE can land before the lookup.
      const [inserted] = await tx.entry.createManyAndReturn({
        data: [key],
        skipDuplicates: true,
      });
      const entry =
        inserted ??
        (await tx.entry.findUniqueOrThrow({ where: { type_value: key } }));
      await redis.sadd(redisKey(key.type), key.value);

      return { entry, created: inserted !== undefined };
    });
  }

  // Redis only.
  async exists(key: EntryKey): Promise<boolean> {
    return (await this.cache().sismember(redisKey(key.type), key.value)) === 1;
  }

  // Whether there was an entry to remove, in either store. deleteMany rather
  // than delete, which throws when there's none.
  async remove(key: EntryKey): Promise<boolean> {
    const redis = this.cache();

    return this.locked(key, async (tx) => {
      const { count } = await tx.entry.deleteMany({ where: key });
      const removed = await redis.srem(redisKey(key.type), key.value);

      return count > 0 || removed > 0;
    });
  }

  // fn in a transaction holding a lock on the entry until it ends. A
  // transaction-level lock, which PgBouncer's transaction mode allows.
  private locked<T>(key: EntryKey, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`entry:${key.type}:${key.value}`}, 0))`;

      return fn(tx);
    });
  }

  private db(): PrismaClient {
    if (!this.prisma) {
      throw new ServiceUnavailableException('Postgres is not configured');
    }

    return this.prisma;
  }

  private cache(): Redis {
    if (!this.redis) {
      throw new ServiceUnavailableException('Redis is not configured');
    }

    return this.redis;
  }
}
