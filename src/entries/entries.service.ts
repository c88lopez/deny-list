import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PRISMA } from '../database/database.module.js';
import type { Entry, PrismaClient } from '../generated/prisma/client.js';
import type { EntryKey } from './entry.js';

@Injectable()
export class EntriesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient | null) {}

  // The entry, and whether this call created it. Adding one that's already
  // there isn't an error: it returns the existing row.
  async add(key: EntryKey): Promise<{ entry: Entry; created: boolean }> {
    const db = this.db();
    // A DELETE can land between the two queries; then the insert is tried
    // again.
    for (;;) {
      // INSERT ... ON CONFLICT DO NOTHING RETURNING: a row only if inserted.
      const [entry] = await db.entry.createManyAndReturn({
        data: [key],
        skipDuplicates: true,
      });
      if (entry) return { entry, created: true };
      const existing = await db.entry.findUnique({
        where: { type_value: key },
      });
      if (existing) return { entry: existing, created: false };
    }
  }

  async exists(key: EntryKey): Promise<boolean> {
    const entry = await this.db().entry.findUnique({
      where: { type_value: key },
      select: { type: true },
    });

    return entry !== null;
  }

  // Whether there was an entry to remove. deleteMany rather than delete, which
  // throws when there's none.
  async remove(key: EntryKey): Promise<boolean> {
    const { count } = await this.db().entry.deleteMany({ where: key });

    return count > 0;
  }

  private db(): PrismaClient {
    if (!this.prisma) {
      throw new ServiceUnavailableException('Postgres is not configured');
    }

    return this.prisma;
  }
}
