import { Global, Module } from '@nestjs/common';

import { InMemoryAccountErasureRegistry } from './account-erasure-registry';
import { ACCOUNT_ERASURE_REGISTRY } from './account-erasure.port';

/**
 * Cross-context registry for account erasure. Each bounded context registers its contributor on
 * module init; the Identity deletion cascade runs them inside its own transaction.
 */
@Global()
@Module({
  providers: [{ provide: ACCOUNT_ERASURE_REGISTRY, useClass: InMemoryAccountErasureRegistry }],
  exports: [ACCOUNT_ERASURE_REGISTRY],
})
export class AccountErasureModule {}
