import 'reflect-metadata';

// Deterministic, dependency-free environment for unit tests. Integration tests override
// DATABASE_URL/REDIS_URL from the real environment (see test/integration/README.md).
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL ??= 'postgresql://quest:quest@127.0.0.1:65432/quest_unit_unreachable';
process.env.REDIS_URL ??= 'redis://127.0.0.1:65433';
process.env.S3_BUCKET ??= 'quest-test-bucket';
process.env.S3_ENDPOINT ??= 'http://127.0.0.1:65434';
process.env.S3_ACCESS_KEY_ID ??= 'test';
process.env.S3_SECRET_ACCESS_KEY ??= 'test';
process.env.S3_FORCE_PATH_STYLE ??= 'true';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
