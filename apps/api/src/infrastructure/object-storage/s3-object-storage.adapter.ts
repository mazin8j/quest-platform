import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { AppConfig } from '../../config/app-config';
import {
  type ObjectStoragePort,
  type PresignUploadInput,
  type PresignedUpload,
  assertValidObjectKey,
} from './object-storage.port';

const DEFAULT_UPLOAD_TTL_S = 300;
const DEFAULT_DOWNLOAD_TTL_S = 300;
const MAX_TTL_S = 3600;

export function createS3Client(config: AppConfig): S3Client {
  return new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    // Explicit static credentials only for local MinIO; in AWS the task role provides credentials.
    ...(config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: config.S3_ACCESS_KEY_ID,
            secretAccessKey: config.S3_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
}

export class S3ObjectStorageAdapter implements ObjectStoragePort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async presignUpload(input: PresignUploadInput): Promise<PresignedUpload> {
    assertValidObjectKey(input.objectKey);
    const expiresIn = Math.min(input.expiresInSeconds ?? DEFAULT_UPLOAD_TTL_S, MAX_TTL_S);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.contentType,
      ContentLength: input.maxBytes,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': input.contentType, 'content-length': String(input.maxBytes) },
      objectKey: input.objectKey,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async presignDownload(
    objectKey: string,
    expiresInSeconds = DEFAULT_DOWNLOAD_TTL_S,
  ): Promise<string> {
    assertValidObjectKey(objectKey);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      {
        expiresIn: Math.min(expiresInSeconds, MAX_TTL_S),
      },
    );
  }

  async head(
    objectKey: string,
  ): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    assertValidObjectKey(objectKey);
    try {
      const r = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );
      return { exists: true, sizeBytes: r.ContentLength, contentType: r.ContentType };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') return { exists: false };
      throw error;
    }
  }

  async delete(objectKey: string): Promise<void> {
    assertValidObjectKey(objectKey);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return true;
    } catch {
      return false;
    }
  }
}
