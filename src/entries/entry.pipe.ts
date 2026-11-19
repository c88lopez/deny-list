import { BadRequestException, type PipeTransform } from '@nestjs/common';
import { type EntryKey, parseEntry } from './entry.js';

// The type and value of a request (the body of POST, the path of GET and
// DELETE), validated and normalized. 400 with zod's issues when the type is
// unknown or the value isn't valid for it.
export class ParseEntryPipe implements PipeTransform<unknown, EntryKey> {
  transform(input: unknown): EntryKey {
    const result = parseEntry(input);
    if (!result.success) {
      throw new BadRequestException({
        message: 'invalid entry',
        issues: result.error.issues,
      });
    }

    return result.data;
  }
}
