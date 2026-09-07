import type { Database } from './database.module';

/**
 * Either the root database handle or a transaction created by `db.transaction(...)`. Repositories
 * accept an Executor so application services can compose several writes in one transaction.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;
