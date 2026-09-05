/** Injected at build/deploy time via env; falls back to package metadata for local runs. */
export const SERVICE_NAME = 'quest-api';
export const SERVICE_VERSION = process.env.SERVICE_VERSION ?? '0.0.0-dev';
export const SERVICE_COMMIT = process.env.SERVICE_COMMIT ?? 'unknown';
