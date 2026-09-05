import { z } from 'zod';

/**
 * Cursor-based pagination is the QUEST default (stable under concurrent inserts, scales past
 * offset limits). Offset pagination is allowed only for small admin lists and must be documented.
 * Canonical documentation: docs/api/API_CONVENTIONS.md
 */
export const PAGINATION_DEFAULT_LIMIT = 20;
export const PAGINATION_MAX_LIMIT = 100;

export const cursorPaginationQuerySchema = z.object({
  /** Opaque cursor returned by a previous page. */
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(PAGINATION_MAX_LIMIT).default(PAGINATION_DEFAULT_LIMIT),
});
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export const pageInfoSchema = z.object({
  /** Cursor to fetch the next page, or null when this is the last page. */
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PageInfo = z.infer<typeof pageInfoSchema>;

/** Builds the response schema for a paginated collection of `item`. */
export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    pageInfo: pageInfoSchema,
  });
}
export type Paginated<T> = { data: T[]; pageInfo: PageInfo };

/** Sort direction convention: `?sort=field:asc,other:desc`. Fields are whitelisted per endpoint. */
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

export function sortQuerySchema<const F extends readonly [string, ...string[]]>(allowedFields: F) {
  const field = z.enum(allowedFields);
  return z
    .string()
    .transform((raw) => raw.split(',').filter(Boolean))
    .pipe(
      z.array(
        z.string().transform((token, ctx) => {
          const [f, d = 'asc'] = token.split(':');
          const parsedField = field.safeParse(f);
          const parsedDir = sortDirectionSchema.safeParse(d);
          if (!parsedField.success || !parsedDir.success) {
            ctx.addIssue({ code: 'custom', message: `Invalid sort token "${token}"` });
            return z.NEVER;
          }
          return { field: parsedField.data, direction: parsedDir.data };
        }),
      ),
    )
    .optional();
}
