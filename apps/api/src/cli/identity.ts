/**
 * Identity operator CLI (Phase 01). Runs inside the application context so every step uses the
 * same services, audit ledger and events as the API.
 *
 *   pnpm --filter @quest/api identity:grant-role -- <accountId> <ROLE>   bootstrap/adjust staff roles
 *   pnpm --filter @quest/api identity:process-deletions                   execute due deletion requests
 *   pnpm --filter @quest/api identity:process-exports                     fulfil open data-export requests
 *
 * The first SUPER_ADMIN can only be created here (no API path exists by design); afterwards
 * MANAGE_STAFF holders use POST /v1/admin/accounts/:id/roles.
 */
import './load-env';

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { staffRoleSchema, uuidSchema } from '@quest/types';

import { AppModule } from '../app.module';
import { AccountDeletionJob, DataExportService } from '../modules/identity';
import { AccountRepository } from '../modules/identity/infrastructure/account.repository';
import { LifecycleRepository } from '../modules/identity/infrastructure/lifecycle.repository';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    switch (command) {
      case 'grant-role': {
        const accountId = uuidSchema.parse(args[0]);
        const role = staffRoleSchema.parse(args[1]);
        const accounts = app.get(AccountRepository);
        const account = await accounts.findById(accountId);
        if (!account || account.deletedAt) throw new Error('Account not found');
        if (!account.emailVerifiedAt) throw new Error('Staff roles require a verified email');
        const created = await accounts.grantRole(accountId, role, null);
        await app
          .get(LifecycleRepository)
          .audit({ accountId, eventType: 'ROLE_GRANTED', metadata: { role, via: 'cli' } });
        console.warn(
          created ? `Granted ${role} to ${accountId}` : `${accountId} already has ${role}`,
        );
        return;
      }
      case 'process-deletions': {
        const result = await app.get(AccountDeletionJob).processDue();
        console.warn(`Deletions: ${result.deleted} completed, ${result.failed} failed`);
        if (result.failed > 0) process.exitCode = 1;
        return;
      }
      case 'process-exports': {
        const result = await app.get(DataExportService).processOpen();
        console.warn(`Exports: ${result.processed} completed, ${result.failed} failed`);
        if (result.failed > 0) process.exitCode = 1;
        return;
      }
      default:
        console.error(
          'Usage: identity.ts <grant-role <accountId> <ROLE> | process-deletions | process-exports>',
        );
        process.exitCode = 2;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
