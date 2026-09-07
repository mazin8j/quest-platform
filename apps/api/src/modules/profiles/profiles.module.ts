import { Module } from '@nestjs/common';

import { MeProfileController, PublicProfilesController } from './api/profiles.controller';
import { ProfileService } from './application/profile.service';
import { ProfileRepository } from './infrastructure/profile.repository';
import { BLOCK_QUERY, PROFILE_PROVISIONER, PROFILE_QUERY } from './ports/profile-provisioning.port';

/**
 * Profiles bounded context: public profile, interests/onboarding, privacy settings, blocks.
 * Downstream of Identity: it never imports the Identity module; Identity drives it through the
 * exported provisioning port and reads it through the query ports.
 */
@Module({
  controllers: [MeProfileController, PublicProfilesController],
  providers: [
    ProfileRepository,
    ProfileService,
    { provide: PROFILE_PROVISIONER, useExisting: ProfileService },
    { provide: PROFILE_QUERY, useExisting: ProfileService },
    { provide: BLOCK_QUERY, useExisting: ProfileService },
  ],
  exports: [PROFILE_PROVISIONER, PROFILE_QUERY, BLOCK_QUERY],
})
export class ProfilesModule {}
