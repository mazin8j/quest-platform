# ADR-005 — Direct-to-object-storage media uploads

## Status

Accepted (2026-09-04, Phase 00)

## Context

Evidence photos/videos are large; proxying them through the API would consume API CPU/memory, inflate latency and make horizontal scaling expensive (CLAUDE.md rule 7). Uploads must be authorised, size- and type-limited, scanned and never publicly listable.

## Decision

Clients request an upload authorisation from the API; the API validates policy and returns a short-lived pre-signed `PUT` URL bound to a namespaced object key, content type and maximum size (`ObjectStoragePort.presignUpload`). Bytes go directly to S3-compatible storage (MinIO locally, S3 in AWS) which emits a media event for asynchronous scanning/transcoding (Phase 05). Delivery is via CloudFront with Origin Access Control; the bucket is private with a TLS-only policy, SSE, versioning and lifecycle rules (Terraform `modules/s3-media`). Domain modules use the `OBJECT_STORAGE` port only; the AWS SDK is confined to the adapter (dependency-cruiser rule). The API JSON body limit is 256 KB, making accidental proxying impossible.

## Alternatives Considered

- **Multipart upload through the API** — rejected: scaling cost, timeouts on mobile networks.
- **Third-party upload service (Cloudinary/Mux)** — deferred: possible later for transcoding, behind the same port.

## Consequences

- Positive: API stays small and stateless; uploads scale with S3; strong isolation of user content.
- Negative: client must handle a two-step flow and retries; CORS on the bucket must list app origins.
- Privacy: EXIF/location metadata policy is defined in Phase 05 before any evidence is stored.

## Revisit Triggers

Need for resumable uploads (> 100 MB videos), on-the-fly transformations, or multi-region media replication.
