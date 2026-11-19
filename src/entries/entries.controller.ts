import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { EntriesService } from './entries.service.js';
import type { EntryKey } from './entry.js';
import { ParseEntryPipe } from './entry.pipe.js';

type EntryBody = { type: string; value: string; createdAt: Date };

// 404 unless the entry was there.
function found(ok: boolean): void {
  if (!ok) throw new NotFoundException();
}

// The type and value of GET and DELETE are in the path, not the query string:
// Express's query parser turns "+" into a space (a+b@x.com). Clients
// URL-encode the value, e.g. the ":" of IPv6 addresses.
@Controller('entries')
export class EntriesController {
  constructor(private readonly entries: EntriesService) {}

  // 201 when the entry is new, 200 with the existing one when it was already
  // there.
  @Post()
  async add(
    @Body(ParseEntryPipe) key: EntryKey,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EntryBody> {
    const { entry, created } = await this.entries.add(key);
    res.status(created ? 201 : 200);

    return { type: entry.type, value: entry.value, createdAt: entry.createdAt };
  }

  // 204 when the entry exists, 404 when it doesn't. Express answers HEAD with
  // this route too.
  @Get(':type/:value')
  @HttpCode(204)
  async check(@Param(ParseEntryPipe) key: EntryKey): Promise<void> {
    found(await this.entries.exists(key));
  }

  // 204 when an entry was removed, 404 when there was none.
  @Delete(':type/:value')
  @HttpCode(204)
  async remove(@Param(ParseEntryPipe) key: EntryKey): Promise<void> {
    found(await this.entries.remove(key));
  }
}
