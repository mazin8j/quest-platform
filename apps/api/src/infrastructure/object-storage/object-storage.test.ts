import { describe, expect, it } from 'vitest';

import { assertValidObjectKey } from './object-storage.port';

describe('object key policy', () => {
  it('accepts namespaced, lowercase keys', () => {
    expect(() => assertValidObjectKey('evidence/018f3f2e/photo-1.jpg')).not.toThrow();
    expect(() => assertValidObjectKey('avatars/u_1.webp')).not.toThrow();
  });

  it('rejects traversal, absolute paths, uppercase and oversize keys', () => {
    expect(() => assertValidObjectKey('../etc/passwd')).toThrow();
    expect(() => assertValidObjectKey('evidence/../../x')).toThrow();
    expect(() => assertValidObjectKey('/evidence/x')).toThrow();
    expect(() => assertValidObjectKey('evidence//x')).toThrow();
    expect(() => assertValidObjectKey('Evidence/X.JPG')).toThrow();
    expect(() => assertValidObjectKey('a'.repeat(300))).toThrow();
    expect(() => assertValidObjectKey('ab')).toThrow();
  });
});
