import { parseEntry } from './entry.js';

function value(type: string, value: string): string | undefined {
  const result = parseEntry({ type, value });

  return result.success ? result.data.value : undefined;
}

describe('parseEntry', () => {
  it('accepts IPv4 addresses as they are', () => {
    expect(value('ip', '192.0.2.1')).toBe('192.0.2.1');
  });

  it('writes IPv6 addresses in their canonical form', () => {
    expect(value('ip', '2001:DB8:0:0:0:0:0:1')).toBe('2001:db8::1');
    expect(value('ip', '::1')).toBe('::1');
  });

  it('writes IPv4-mapped IPv6 addresses as IPv4', () => {
    expect(value('ip', '::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(value('ip', '::FFFF:C000:0201')).toBe('192.0.2.1');
    expect(value('ip', '0:0:0:0:0:ffff:0a00:0001')).toBe('10.0.0.1');
  });

  it('keeps other IPv6 addresses that embed an IPv4 one as IPv6', () => {
    expect(value('ip', '64:ff9b::192.0.2.1')).toBe('64:ff9b::c000:201');
    expect(value('ip', '::192.0.2.1')).toBe('::c000:201');
  });

  it('rejects what is not an IP address', () => {
    expect(value('ip', '256.0.0.1')).toBeUndefined();
    expect(value('ip', 'example.com')).toBeUndefined();
    expect(value('ip', ' 192.0.2.1')).toBeUndefined();
  });

  it('trims and lowercases emails', () => {
    expect(value('email', ' A+b@X.com ')).toBe('a+b@x.com');
  });

  it('rejects what is not an email', () => {
    expect(value('email', 'not-an-email')).toBeUndefined();
    expect(value('email', '@x.com')).toBeUndefined();
  });

  it('trims and lowercases domains, dropping a trailing dot', () => {
    expect(value('domain', ' Example.COM. ')).toBe('example.com');
    expect(value('domain', 'a.b.example.com')).toBe('a.b.example.com');
  });

  it('rejects domains without a dot, or not a hostname', () => {
    expect(value('domain', 'localhost')).toBeUndefined();
    expect(value('domain', 'exa mple.com')).toBeUndefined();
    expect(value('domain', 'a@x.com')).toBeUndefined();
  });

  it('rejects an unknown type, or a missing value', () => {
    expect(parseEntry({ type: 'phone', value: '123' }).success).toBe(false);
    expect(parseEntry({ type: 'ip' }).success).toBe(false);
    expect(parseEntry(undefined).success).toBe(false);
  });
});
