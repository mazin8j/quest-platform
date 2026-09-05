import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';

import { ApiError } from '../filters/api-error';

/**
 * Validates and transforms a request part with a zod schema. Contract-first: schemas live in
 * @quest/types (shared with clients) or next to the controller. Usage:
 *   @Body(new ZodValidationPipe(createThingSchema)) body: CreateThing
 * Unknown keys are stripped by default (`z.object` strips) which is the QUEST convention.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown, _metadata: ArgumentMetadata): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw ApiError.validation(
      result.error.issues.map((i) => ({
        path: i.path.map(String).join('.') || '(root)',
        message: i.message,
        code: i.code,
      })),
    );
  }
}
