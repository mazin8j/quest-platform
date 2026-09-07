/**
 * Object storage port (ADR-005). Domain modules depend on this interface only; the S3 adapter is
 * the single implementation for both MinIO (local) and AWS S3 (cloud).
 * Uploads are direct-to-storage: the API issues a pre-signed URL, the client PUTs the bytes.
 */
export interface PresignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send exactly (content type / length constraints). */
  headers: Record<string, string>;
  objectKey: string;
  expiresAt: string;
}

export interface PresignUploadInput {
  /** Namespaced key chosen by the caller, e.g. "evidence/<participationId>/<uuid>.jpg". */
  objectKey: string;
  contentType: string;
  /** Upper bound enforced by policy; the adapter encodes it into the signature where supported. */
  maxBytes: number;
  expiresInSeconds?: number;
}

export interface ObjectStoragePort {
  presignUpload(input: PresignUploadInput): Promise<PresignedUpload>;
  presignDownload(objectKey: string, expiresInSeconds?: number): Promise<string>;
  head(objectKey: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }>;
  /**
   * Server-side write for small, system-generated objects only (data-export bundles, reports).
   * User media never goes through here (ADR-005: direct-to-storage uploads).
   */
  putObject(input: {
    objectKey: string;
    body: Buffer | string;
    contentType: string;
  }): Promise<void>;
  delete(objectKey: string): Promise<void>;
  /** Cheap probe for readiness. */
  ping(): Promise<boolean>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** Object keys are validated to avoid path tricks and unbounded lengths. */
export const OBJECT_KEY_PATTERN = /^[a-z0-9][a-z0-9/_.-]{2,254}$/;

export function assertValidObjectKey(key: string): void {
  if (!OBJECT_KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('Invalid object key');
  }
}
