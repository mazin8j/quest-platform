import { describe, expect, it } from 'vitest';

import { readPublicEnv } from './env';

describe('web public env', () => {
  it('applies local defaults and validates URLs', () => {
    expect(readPublicEnv({}).NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:4000');
    expect(
      readPublicEnv({ NEXT_PUBLIC_API_BASE_URL: 'https://api.quest.example' })
        .NEXT_PUBLIC_API_BASE_URL,
    ).toBe('https://api.quest.example');
    expect(() => readPublicEnv({ NEXT_PUBLIC_API_BASE_URL: 'not a url' })).toThrow(
      /NEXT_PUBLIC_API_BASE_URL/,
    );
    expect(() => readPublicEnv({ NEXT_PUBLIC_APP_ENV: 'prod' })).toThrow(/NEXT_PUBLIC_APP_ENV/);
  });
});
