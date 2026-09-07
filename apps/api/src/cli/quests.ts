/**
 * Quest operator CLI (Phase 02). Runs inside the application context so every step uses the same
 * services, audit ledger and events as the API.
 *
 *   pnpm --filter @quest/api quests:process-expiries   expire attempts past their completion window
 *
 * This is the production entry point for the participation expiry sweep. Without it the sweep
 * existed but nothing ever called it, so a started attempt stayed STARTED forever and permanently
 * occupied the participant's one active slot on that Quest (audit P02-11). A scheduled worker
 * replaces this command when the deployment exists (BACKLOG TD-21), exactly as for the Phase 01
 * deletion and export jobs; the sweep is idempotent, so running it twice is harmless.
 */
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { ParticipationService } from '../modules/quests';
import { applyDevEnv } from './load-env';

async function main(): Promise<void> {
  applyDevEnv();
  const [command] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    switch (command) {
      case 'process-expiries': {
        const result = await app.get(ParticipationService).expireDue();
        console.warn(`Participation expiry: ${result.expired} attempts expired`);
        return;
      }
      default:
        console.error('Usage: quests.ts <process-expiries>');
        process.exitCode = 1;
        return;
    }
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
