import { randomBytes } from 'node:crypto';

/**
 * UUID v7 (RFC 9562): 48-bit Unix millisecond timestamp + 74 random bits. Time-ordered for index
 * locality (docs/architecture/05_DATA_ARCHITECTURE.md), unguessable, and generated in the
 * application so ids exist before the row is written (events, logs, idempotency).
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  // 48-bit big-endian timestamp.
  bytes[0] = (now / 2 ** 40) & 0xff;
  bytes[1] = (now / 2 ** 32) & 0xff;
  bytes[2] = (now / 2 ** 24) & 0xff;
  bytes[3] = (now / 2 ** 16) & 0xff;
  bytes[4] = (now / 2 ** 8) & 0xff;
  bytes[5] = now & 0xff;
  // Version 7 in the high nibble of byte 6; RFC 4122 variant (10xx) in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Millisecond timestamp encoded in a v7 UUID (undefined for other versions). */
export function uuidv7Timestamp(id: string): number | undefined {
  const hex = id.replace(/-/g, '');
  if (hex.length !== 32 || hex[12] !== '7') return undefined;
  return Number.parseInt(hex.slice(0, 12), 16);
}
