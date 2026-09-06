import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AvatarUploadResponse,
  type BlockView,
  type Interest,
  type OnboardingStatus,
  type OwnProfileView,
  type Paginated,
  Permission,
  type PrivacySettings,
  type PublicProfileView,
  type UsernameAvailabilityResponse,
  avatarUploadRequestSchema,
  blockUserRequestSchema,
  updateInterestsRequestSchema,
  updatePrivacySettingsRequestSchema,
  updateProfileRequestSchema,
  uuidSchema,
} from '@quest/types';
import type { Request } from 'express';
import { z } from 'zod';

import {
  CurrentPrincipal,
  Public,
  RequirePermission,
  RequireVerifiedEmail,
  principalFromRequest,
} from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { ProfileService } from '../application/profile.service';

const usernameParam = z.string().min(1).max(64);
const availabilityQuery = z.object({ username: z.string().min(1).max(64) });

function page<T>(data: T[]): Paginated<T> {
  return { data, pageInfo: { nextCursor: null, hasMore: false } };
}

/** Own profile, onboarding, privacy and block controls. All routes require a principal. */
@Controller({ path: 'me', version: '1' })
export class MeProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  getOwn(@CurrentPrincipal() principal: Principal): Promise<OwnProfileView> {
    return this.profiles.getOwnProfile(principal);
  }

  @Put('profile')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  update(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateProfileRequestSchema))
    body: z.infer<typeof updateProfileRequestSchema>,
  ): Promise<OwnProfileView> {
    return this.profiles.updateProfile(principal, body);
  }

  @Post('profile/avatar-upload')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  @RequireVerifiedEmail()
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  avatarUpload(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(avatarUploadRequestSchema))
    body: z.infer<typeof avatarUploadRequestSchema>,
  ): Promise<AvatarUploadResponse> {
    return this.profiles.presignAvatarUpload(principal, body);
  }

  @Get('interests')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  async getInterests(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ interestKeys: string[] }> {
    return { interestKeys: await this.profiles.getInterests(principal.accountId) };
  }

  @Put('interests')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  async updateInterests(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updateInterestsRequestSchema))
    body: z.infer<typeof updateInterestsRequestSchema>,
  ): Promise<{ interestKeys: string[] }> {
    return { interestKeys: await this.profiles.updateInterests(principal, body.interestKeys) };
  }

  @Get('onboarding')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  onboarding(@CurrentPrincipal() principal: Principal): Promise<OnboardingStatus> {
    return this.profiles.onboardingStatus(principal);
  }

  @Post('onboarding/complete')
  @RequirePermission(Permission.MANAGE_OWN_PROFILE)
  @RequireVerifiedEmail()
  @HttpCode(200)
  completeOnboarding(@CurrentPrincipal() principal: Principal): Promise<OnboardingStatus> {
    return this.profiles.completeOnboarding(principal);
  }

  @Get('privacy')
  @RequirePermission(Permission.MANAGE_OWN_PRIVACY)
  getPrivacy(@CurrentPrincipal() principal: Principal): Promise<PrivacySettings> {
    return this.profiles.getPrivacy(principal);
  }

  @Put('privacy')
  @RequirePermission(Permission.MANAGE_OWN_PRIVACY)
  updatePrivacy(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(updatePrivacySettingsRequestSchema))
    body: z.infer<typeof updatePrivacySettingsRequestSchema>,
  ): Promise<PrivacySettings> {
    return this.profiles.updatePrivacy(principal, body);
  }

  @Get('blocks')
  @RequirePermission(Permission.MANAGE_OWN_BLOCKS)
  async listBlocks(@CurrentPrincipal() principal: Principal): Promise<Paginated<BlockView>> {
    return page(await this.profiles.listBlocks(principal));
  }

  @Post('blocks')
  @RequirePermission(Permission.MANAGE_OWN_BLOCKS)
  @HttpCode(204)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  async block(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(blockUserRequestSchema))
    body: z.infer<typeof blockUserRequestSchema>,
  ): Promise<void> {
    await this.profiles.block(principal, body.accountId);
  }

  @Delete('blocks/:accountId')
  @RequirePermission(Permission.MANAGE_OWN_BLOCKS)
  @HttpCode(204)
  async unblock(
    @CurrentPrincipal() principal: Principal,
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
  ): Promise<void> {
    await this.profiles.unblock(principal, accountId);
  }
}

/** Public reads: interest catalogue, username availability, public profile by handle. */
@Controller({ path: '', version: '1' })
export class PublicProfilesController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('interests')
  @Public()
  async catalogue(): Promise<{ data: Interest[] }> {
    return { data: await this.profiles.catalogue() };
  }

  @Get('profiles/username-availability')
  @Public()
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  availability(
    @Query(new ZodValidationPipe(availabilityQuery)) query: z.infer<typeof availabilityQuery>,
    @Req() req: Request,
  ): Promise<UsernameAvailabilityResponse> {
    return this.profiles.usernameAvailability(query.username, principalFromRequest(req)?.accountId);
  }

  @Get('profiles/:username')
  @Public()
  @Throttle({ global: { limit: 60, ttl: 60_000 } })
  publicProfile(
    @Param('username', new ZodValidationPipe(usernameParam)) username: string,
    @Req() req: Request,
  ): Promise<PublicProfileView> {
    return this.profiles.getPublicProfile(username, principalFromRequest(req) ?? null);
  }
}
