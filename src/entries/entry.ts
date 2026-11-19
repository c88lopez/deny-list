import { z } from 'zod';
import type { EntryType } from '../generated/prisma/enums.js';

// "::FFFF:0:1" and "::ffff:0.0.0.1" are the same address; the URL parser
// writes every IPv6 address the same way (lowercase, compressed, RFC 5952).
// An IPv4-mapped address (::ffff:192.0.2.1, which Node reports for IPv4
// clients on a dual-stack socket) is the IPv4 address itself, so it's stored
// and looked up as 192.0.2.1.
function canonicalIpv6(v: string): string {
  const canonical = new URL(`http://[${v}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const hi = parseInt(mapped[1] ?? '', 16);
  const lo = parseInt(mapped[2] ?? '', 16);

  return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.');
}

const ip = z.union([z.ipv4(), z.ipv6().transform(canonicalIpv6)]);

const email = z.string().trim().toLowerCase().pipe(z.email());

const domain = z
  .string()
  .trim()
  .toLowerCase()
  // "example.com." (fully qualified) is the same domain as "example.com".
  .transform((v) => (v.endsWith('.') ? v.slice(0, -1) : v))
  .pipe(
    z
      .hostname()
      .refine((v) => v.includes('.'), 'want a domain with a dot, like x.com'),
  );

// Values are stored normalized, so "A@X.com" and "a@x.com" are one entry and
// a lookup finds it however it's written. Every EntryType needs a rule here.
const entrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ip'), value: ip }),
  z.object({ type: z.literal('email'), value: email }),
  z.object({ type: z.literal('domain'), value: domain }),
]) satisfies z.ZodType<{ type: EntryType; value: string }>;

export type EntryKey = z.output<typeof entrySchema>;

// The type and value of a request, validated and normalized for the type.
export function parseEntry(input: unknown): z.ZodSafeParseResult<EntryKey> {
  return entrySchema.safeParse(input);
}
