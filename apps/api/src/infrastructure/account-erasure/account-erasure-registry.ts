import type { AccountErasureContributor, AccountErasureRegistryPort } from './account-erasure.port';

export class InMemoryAccountErasureRegistry implements AccountErasureRegistryPort {
  private readonly items = new Map<string, AccountErasureContributor>();

  register(contributor: AccountErasureContributor): void {
    if (this.items.has(contributor.context)) {
      throw new Error(`Account erasure contributor already registered for ${contributor.context}`);
    }
    this.items.set(contributor.context, contributor);
  }

  contributors(): ReadonlyArray<AccountErasureContributor> {
    return [...this.items.values()];
  }
}
