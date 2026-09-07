import {
  type ObjectStoragePort,
  type PresignUploadInput,
  type PresignedUpload,
  assertValidObjectKey,
} from '../../../src/infrastructure/object-storage/object-storage.port';

/** Deterministic storage fake for integration tests (CI has PostgreSQL + Redis, no MinIO). */
export class InMemoryObjectStorage implements ObjectStoragePort {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    assertValidObjectKey(input.objectKey);
    return Promise.resolve({
      url: `https://storage.test/upload/${input.objectKey}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'content-length': String(input.maxBytes) },
      objectKey: input.objectKey,
      expiresAt: new Date(Date.now() + 600_000).toISOString(),
    });
  }

  presignDownload(objectKey: string): Promise<string> {
    assertValidObjectKey(objectKey);
    return Promise.resolve(`https://storage.test/download/${objectKey}?sig=test`);
  }

  head(objectKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    const o = this.objects.get(objectKey);
    return Promise.resolve(
      o
        ? { exists: true, sizeBytes: o.body.length, contentType: o.contentType }
        : { exists: false },
    );
  }

  putObject(input: {
    objectKey: string;
    body: Buffer | string;
    contentType: string;
  }): Promise<void> {
    assertValidObjectKey(input.objectKey);
    this.objects.set(input.objectKey, {
      body: Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body, 'utf8'),
      contentType: input.contentType,
    });
    return Promise.resolve();
  }

  delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
    return Promise.resolve();
  }

  ping(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /** Simulates a client completing a pre-signed upload. */
  simulateUpload(objectKey: string, contentType = 'image/jpeg'): void {
    this.objects.set(objectKey, { body: Buffer.from('fake-image'), contentType });
  }
}
