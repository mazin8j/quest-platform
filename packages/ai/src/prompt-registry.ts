import { z } from 'zod';

/**
 * Prompts are versioned artifacts, never inline strings in feature code. Each invocation records
 * the exact promptId@version used so any decision can be reproduced and audited.
 */
export const promptVersionSchema = z.object({
  promptId: z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
  /** Semantic-ish integer version. */
  version: z.number().int().positive(),
  /** Template with {{placeholders}}. Rendering is the provider adapter's concern. */
  template: z.string().min(1),
  /** Names the template expects; the registry validates they are supplied. */
  variables: z.array(z.string()).default([]),
  /** Free-text change note for reviewers. */
  changeNote: z.string().optional(),
  status: z.enum(['DRAFT', 'ACTIVE', 'DEPRECATED']).default('ACTIVE'),
});
export type PromptVersion = z.infer<typeof promptVersionSchema>;
export type PromptVersionInput = z.input<typeof promptVersionSchema>;

export interface PromptRegistry {
  register(prompt: PromptVersionInput): void;
  /** Latest ACTIVE version, or the pinned version when given. */
  resolve(promptId: string, version?: number): PromptVersion;
  render(prompt: PromptVersion, variables: Record<string, string>): string;
  list(): ReadonlyArray<PromptVersion>;
}

export class PromptNotFoundError extends Error {
  constructor(promptId: string, version?: number) {
    super(`Prompt ${promptId}${version ? `@${version}` : ''} not found or not ACTIVE`);
    this.name = 'PromptNotFoundError';
  }
}

/** In-memory registry; Phase 06 may back it with a table or versioned files. */
export class InMemoryPromptRegistry implements PromptRegistry {
  private readonly prompts = new Map<string, Map<number, PromptVersion>>();

  register(prompt: PromptVersionInput): void {
    const parsed = promptVersionSchema.parse(prompt);
    const versions = this.prompts.get(parsed.promptId) ?? new Map<number, PromptVersion>();
    if (versions.has(parsed.version)) {
      throw new Error(`Prompt ${parsed.promptId}@${parsed.version} already registered (immutable)`);
    }
    versions.set(parsed.version, Object.freeze(parsed));
    this.prompts.set(parsed.promptId, versions);
  }

  resolve(promptId: string, version?: number): PromptVersion {
    const versions = this.prompts.get(promptId);
    if (!versions) throw new PromptNotFoundError(promptId, version);
    if (version !== undefined) {
      const p = versions.get(version);
      if (!p) throw new PromptNotFoundError(promptId, version);
      return p;
    }
    const active = [...versions.values()]
      .filter((p) => p.status === 'ACTIVE')
      .sort((a, b) => b.version - a.version);
    const latest = active[0];
    if (!latest) throw new PromptNotFoundError(promptId);
    return latest;
  }

  render(prompt: PromptVersion, variables: Record<string, string>): string {
    const missing = prompt.variables.filter((v) => !(v in variables));
    if (missing.length > 0) {
      throw new Error(
        `Prompt ${prompt.promptId}@${prompt.version} missing variables: ${missing.join(', ')}`,
      );
    }
    return prompt.template.replace(
      /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g,
      (_m, name: string) => variables[name] ?? '',
    );
  }

  list(): ReadonlyArray<PromptVersion> {
    return [...this.prompts.values()].flatMap((m) => [...m.values()]);
  }
}
