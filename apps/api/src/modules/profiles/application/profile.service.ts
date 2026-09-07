import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ProfileUpdated, createEvent, type EventPublisher } from '@quest/events';
import {
  AVATAR_OBJECT_KEY_PATTERN,
  type AgeBand,
  type AvatarUploadRequest,
  type AvatarUploadResponse,
  type BlockView,
  INTERESTS_MIN_FOR_ONBOARDING,
  type Interest,
  type OnboardingStatus,
  type OwnProfileView,
  type PrivacySettings,
  type PublicProfileView,
  type UpdatePrivacySettingsRequest,
  type UpdateProfileRequest,
  type UsernameAvailabilityResponse,
  privacyDefaultsFor,
  privacyPolicyViolations,
  usernameSchema,
  AGE_BAND_PRIVACY_POLICY,
} from '@quest/types';

import type { Principal } from '../../../common/auth/principal';
import { getRequestContext } from '../../../common/context/request-context';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { isUniqueViolation } from '../../../common/persistence/unique-violation';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  DATA_EXPORT_REGISTRY,
  type DataExportRegistryPort,
} from '../../../infrastructure/data-export/data-export.port';
import { EVENT_PUBLISHER } from '../../../infrastructure/events/events.module';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../../infrastructure/object-storage/object-storage.port';
import type { PrivacyRecord, ProfileRecord } from '../infrastructure/profile.repository';
import { ProfileRepository } from '../infrastructure/profile.repository';
import type {
  BlockQueryPort,
  ProfileProvisioningPort,
  ProfileQueryPort,
} from '../ports/profile-provisioning.port';

const SOURCE = 'api.profiles';
const AVATAR_URL_TTL_S = 3600;
/** Bound on the block list copied into an export bundle (audit P01-14). */
const EXPORT_MAX_BLOCK_ROWS = 1000;
/** Profile language when the account states none, and the value erasure resets it to (P01-05). */
const DEFAULT_PROFILE_LANGUAGE = 'en';

/** Principal facts the Profiles context needs; the age band comes from Identity, never the DOB. */
export type ProfilePrincipal = Pick<Principal, 'accountId' | 'emailVerified' | 'ageBand'>;

@Injectable()
export class ProfileService
  implements ProfileProvisioningPort, ProfileQueryPort, BlockQueryPort, OnModuleInit
{
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    @Inject(DATA_EXPORT_REGISTRY) private readonly exportRegistry: DataExportRegistryPort,
    private readonly repo: ProfileRepository,
  ) {}

  onModuleInit(): void {
    this.exportRegistry.register({
      context: 'profiles',
      schemaVersion: 1,
      exportAccountData: (accountId) => this.exportAccountData(accountId),
    });
  }

  // ------------------------------------------------------------------ provisioning port ----

  async provisionForAccount(
    input: { accountId: string; ageBand: AgeBand; language: string | null; country: string | null },
    tx?: Executor,
  ): Promise<void> {
    await this.repo.insert(
      {
        accountId: input.accountId,
        language: input.language ?? DEFAULT_PROFILE_LANGUAGE,
        country: input.country,
      },
      tx,
    );
    await this.repo.upsertPrivacy(
      { accountId: input.accountId, ...privacyDefaultsFor(input.ageBand) },
      tx,
    );
  }

  async setAccountActive(accountId: string, active: boolean, tx?: Executor): Promise<void> {
    await this.repo.update(accountId, { accountActive: active }, tx);
  }

  /** Returns the storage keys the caller deletes after commit (audit P01-02). */
  async eraseAccount(accountId: string, tx?: Executor): Promise<string[]> {
    const existing = await this.repo.findByAccountId(accountId, tx);
    if (!existing) return [];
    const objectKeys = existing.avatarObjectKey ? [existing.avatarObjectKey] : [];
    await this.repo.replaceInterests(accountId, [], tx);
    await this.repo.deleteBlocksInvolving(accountId, tx);
    await this.repo.deletePrivacy(accountId, tx);
    await this.repo.update(
      accountId,
      {
        username: null,
        displayName: null,
        bio: '',
        avatarObjectKey: null,
        country: null,
        timezone: null,
        language: DEFAULT_PROFILE_LANGUAGE,
        accountActive: false,
        erasedAt: existing.erasedAt ?? new Date(),
      },
      tx,
    );
    return objectKeys;
  }

  // ------------------------------------------------------------------------- query port ----

  async onboardingFacts(accountId: string, tx?: Executor) {
    const p = await this.repo.findByAccountId(accountId, tx);
    const interestCount = await this.repo.countInterests(accountId, tx);
    return {
      hasUsername: !!p?.username,
      hasDisplayName: !!p?.displayName,
      interestCount,
      onboardingCompletedAt: p?.onboardingCompletedAt ?? null,
      username: p?.username ?? null,
    };
  }

  isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    return this.repo.isBlockedEitherWay(a, b);
  }

  // ---------------------------------------------------------------------- own profile ----

  async getOwnProfile(principal: ProfilePrincipal): Promise<OwnProfileView> {
    const p = await this.requireProfile(principal.accountId);
    const interests = await this.repo.selectedInterests(principal.accountId);
    return this.toOwnView(p, interests);
  }

  async updateProfile(
    principal: ProfilePrincipal,
    patch: UpdateProfileRequest,
  ): Promise<OwnProfileView> {
    const current = await this.requireProfile(principal.accountId);
    const changed = Object.keys(patch).filter(
      (k) => patch[k as keyof UpdateProfileRequest] !== undefined,
    );
    if (changed.length === 0) return this.getOwnProfile(principal);

    if (patch.avatarObjectKey) {
      if (!patch.avatarObjectKey.startsWith(`avatars/${principal.accountId}/`)) {
        throw ApiError.forbidden('Avatar key does not belong to this account');
      }
      const head = await this.storage.head(patch.avatarObjectKey);
      if (!head.exists)
        throw ApiError.validation([{ path: 'avatarObjectKey', message: 'Upload not found' }]);
    }

    try {
      await this.repo.update(principal.accountId, {
        ...(patch.username !== undefined ? { username: patch.username } : {}),
        ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
        ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
        ...(patch.avatarObjectKey !== undefined ? { avatarObjectKey: patch.avatarObjectKey } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.country !== undefined ? { country: patch.country } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw ApiError.conflict('Username is already taken');
      throw error;
    }

    if (
      patch.avatarObjectKey !== undefined &&
      current.avatarObjectKey &&
      current.avatarObjectKey !== patch.avatarObjectKey
    ) {
      await this.storage.delete(current.avatarObjectKey).catch(() => undefined);
    }

    this.metrics.increment('quest.profiles.updated', 1, { fields: changed.length });
    await this.events.publish(
      createEvent(
        ProfileUpdated,
        { accountId: principal.accountId, changedFields: changed },
        {
          aggregateId: principal.accountId,
          correlationId: getRequestContext()?.correlationId ?? uuidv7(),
          source: SOURCE,
          actorId: principal.accountId,
        },
      ),
    );
    return this.getOwnProfile(principal);
  }

  async usernameAvailability(
    raw: string,
    requester?: string,
  ): Promise<UsernameAvailabilityResponse> {
    const parsed = usernameSchema.safeParse(raw);
    if (!parsed.success) {
      const reserved = parsed.error.issues.some((i) => /reserved/i.test(i.message));
      return { username: raw, available: false, reason: reserved ? 'RESERVED' : 'INVALID' };
    }
    const existing = await this.repo.findByUsername(parsed.data);
    if (existing && existing.accountId !== requester) {
      return { username: parsed.data, available: false, reason: 'TAKEN' };
    }
    return { username: parsed.data, available: true, reason: null };
  }

  async presignAvatarUpload(
    principal: ProfilePrincipal,
    input: AvatarUploadRequest,
  ): Promise<AvatarUploadResponse> {
    const ext =
      input.contentType === 'image/jpeg'
        ? 'jpg'
        : input.contentType === 'image/png'
          ? 'png'
          : 'webp';
    const objectKey = `avatars/${principal.accountId}/${uuidv7()}.${ext}`;
    if (!AVATAR_OBJECT_KEY_PATTERN.test(objectKey)) throw new Error('Avatar key generation failed');
    const presigned = await this.storage.presignUpload({
      objectKey,
      contentType: input.contentType,
      maxBytes: input.sizeBytes,
      expiresInSeconds: 600,
    });
    return {
      objectKey,
      uploadUrl: presigned.url,
      method: 'PUT',
      headers: presigned.headers,
      expiresAt: presigned.expiresAt,
    };
  }

  // ------------------------------------------------------------------- public profile ----

  async getPublicProfile(
    username: string,
    viewer: ProfilePrincipal | null,
  ): Promise<PublicProfileView> {
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success) throw ApiError.notFound('Profile');
    const p = await this.repo.findByUsername(parsed.data);
    if (!p || p.erasedAt || !p.username || !p.displayName) throw ApiError.notFound('Profile');
    const isOwner = viewer?.accountId === p.accountId;
    if (!isOwner) {
      if (!p.accountActive) throw ApiError.notFound('Profile');
      if (viewer && (await this.repo.isBlockedEitherWay(viewer.accountId, p.accountId))) {
        throw ApiError.notFound('Profile');
      }
    }
    const privacy = await this.requirePrivacy(p.accountId);
    // FOLLOWERS resolves to "limited" until the social graph exists (Phase 03); PRIVATE is limited.
    const limited = !isOwner && privacy.profileVisibility !== 'PUBLIC';
    // Non-public profiles are not visible to anonymous callers at all: a limited card (handle +
    // display name, no photo) is a signed-in-only affordance, which also keeps minors — who can
    // never be PUBLIC below 16 — invisible to unauthenticated scraping.
    if (limited && !viewer) throw ApiError.notFound('Profile');
    const interests = limited ? [] : await this.repo.selectedInterests(p.accountId);
    return {
      accountId: p.accountId,
      username: p.username,
      displayName: p.displayName,
      bio: limited ? '' : p.bio,
      avatarUrl: limited ? null : await this.avatarUrl(p.avatarObjectKey),
      country: !limited && privacy.locationVisibility !== 'HIDDEN' ? p.country : null,
      isLimited: limited,
      interests,
    };
  }

  // ------------------------------------------------------------------------- interests ----

  async catalogue(): Promise<Interest[]> {
    return this.repo.catalogue();
  }

  async getInterests(accountId: string): Promise<string[]> {
    return this.repo.selectedInterests(accountId);
  }

  async updateInterests(principal: ProfilePrincipal, keys: string[]): Promise<string[]> {
    const active = new Set(await this.repo.activeKeys(keys));
    const unknown = keys.filter((k) => !active.has(k));
    if (unknown.length > 0) {
      throw ApiError.validation(
        unknown.map((k) => ({ path: 'interestKeys', message: `Unknown interest "${k}"` })),
      );
    }
    await this.db.transaction((tx) => this.repo.replaceInterests(principal.accountId, keys, tx));
    this.metrics.increment('quest.profiles.interests_updated', 1, { count: keys.length });
    return keys;
  }

  // ------------------------------------------------------------------------ onboarding ----

  async onboardingStatus(principal: ProfilePrincipal): Promise<OnboardingStatus> {
    const facts = await this.onboardingFacts(principal.accountId);
    const missing: OnboardingStatus['missing'] = [];
    if (!principal.emailVerified) missing.push('EMAIL_VERIFIED');
    if (!facts.hasUsername) missing.push('USERNAME');
    if (!facts.hasDisplayName) missing.push('DISPLAY_NAME');
    if (facts.interestCount < INTERESTS_MIN_FOR_ONBOARDING) missing.push('INTERESTS');
    const nextStep: OnboardingStatus['nextStep'] = !principal.emailVerified
      ? 'VERIFY_EMAIL'
      : !facts.hasUsername || !facts.hasDisplayName
        ? 'PROFILE'
        : facts.interestCount < INTERESTS_MIN_FOR_ONBOARDING
          ? 'INTERESTS'
          : 'DONE';
    return { completed: facts.onboardingCompletedAt !== null, nextStep, missing };
  }

  async completeOnboarding(principal: ProfilePrincipal): Promise<OnboardingStatus> {
    const status = await this.onboardingStatus(principal);
    if (status.missing.length > 0) {
      throw ApiError.validation(
        status.missing.map((m) => ({
          path: m,
          message: 'Required before onboarding can complete',
        })),
        'Onboarding is incomplete',
      );
    }
    if (!status.completed) {
      await this.repo.update(principal.accountId, { onboardingCompletedAt: new Date() });
      this.metrics.increment('quest.profiles.onboarding_completed');
    }
    return { ...status, completed: true };
  }

  // --------------------------------------------------------------------------- privacy ----

  async getPrivacy(principal: ProfilePrincipal): Promise<PrivacySettings> {
    const p = await this.requirePrivacy(principal.accountId);
    return this.toPrivacyView(p, principal.ageBand);
  }

  async updatePrivacy(
    principal: ProfilePrincipal,
    patch: UpdatePrivacySettingsRequest,
  ): Promise<PrivacySettings> {
    const violations = privacyPolicyViolations(principal.ageBand, patch);
    if (violations.length > 0) {
      throw ApiError.forbidden(`Age policy does not allow changing: ${violations.join(', ')}`);
    }
    const current = await this.requirePrivacy(principal.accountId);
    const next = await this.repo.upsertPrivacy({
      accountId: principal.accountId,
      profileVisibility: patch.profileVisibility ?? current.profileVisibility,
      locationVisibility: patch.locationVisibility ?? current.locationVisibility,
      challengeInvitesFrom: patch.challengeInvitesFrom ?? current.challengeInvitesFrom,
      discoverable: patch.discoverable ?? current.discoverable,
    });
    this.metrics.increment('quest.profiles.privacy_updated');
    return this.toPrivacyView(next, principal.ageBand);
  }

  // ---------------------------------------------------------------------------- blocks ----

  async block(principal: ProfilePrincipal, targetAccountId: string): Promise<void> {
    if (targetAccountId === principal.accountId)
      throw ApiError.validation([{ path: 'accountId', message: 'Cannot block yourself' }]);
    const target = await this.repo.findByAccountId(targetAccountId);
    // Existence is not disclosed for unknown/erased accounts beyond a generic not-found.
    if (!target || target.erasedAt) throw ApiError.notFound('Account');
    const created = await this.repo.block(principal.accountId, targetAccountId);
    if (created) this.metrics.increment('quest.profiles.blocked');
  }

  async unblock(principal: ProfilePrincipal, targetAccountId: string): Promise<void> {
    const removed = await this.repo.unblock(principal.accountId, targetAccountId);
    if (!removed) throw ApiError.notFound('Block');
  }

  async listBlocks(
    principal: ProfilePrincipal,
    page: { limit: number; cursor?: { blockedAt: Date; accountId: string } },
  ): Promise<BlockView[]> {
    const rows = await this.repo.listBlocks(principal.accountId, page);
    return rows.map((r) => ({
      accountId: r.accountId,
      username: r.username,
      blockedAt: r.blockedAt.toISOString(),
    }));
  }

  // ----------------------------------------------------------------------- data export ----

  async exportAccountData(accountId: string): Promise<unknown> {
    const p = await this.repo.findByAccountId(accountId);
    const privacy = await this.repo.getPrivacy(accountId);
    return {
      profile: p
        ? {
            username: p.username,
            displayName: p.displayName,
            bio: p.bio,
            hasAvatar: p.avatarObjectKey !== null,
            language: p.language,
            country: p.country,
            timezone: p.timezone,
            onboardingCompletedAt: p.onboardingCompletedAt?.toISOString() ?? null,
            createdAt: p.createdAt.toISOString(),
            updatedAt: p.updatedAt.toISOString(),
          }
        : null,
      interests: await this.repo.selectedInterests(accountId),
      privacySettings: privacy
        ? {
            profileVisibility: privacy.profileVisibility,
            locationVisibility: privacy.locationVisibility,
            challengeInvitesFrom: privacy.challengeInvitesFrom,
            discoverable: privacy.discoverable,
            updatedAt: privacy.updatedAt.toISOString(),
          }
        : null,
      blocks: (await this.repo.listBlocks(accountId, { limit: EXPORT_MAX_BLOCK_ROWS })).map(
        (b) => ({
          blockedAccountId: b.accountId,
          blockedAt: b.blockedAt.toISOString(),
        }),
      ),
    };
  }

  // ----------------------------------------------------------------------------- helpers ----

  private async requireProfile(accountId: string): Promise<ProfileRecord> {
    const p = await this.repo.findByAccountId(accountId);
    if (!p || p.erasedAt) throw ApiError.notFound('Profile');
    return p;
  }

  private async requirePrivacy(accountId: string): Promise<PrivacyRecord> {
    const p = await this.repo.getPrivacy(accountId);
    if (!p) throw ApiError.notFound('Privacy settings');
    return p;
  }

  private async avatarUrl(objectKey: string | null): Promise<string | null> {
    if (!objectKey) return null;
    if (this.config.MEDIA_PUBLIC_BASE_URL) {
      return `${this.config.MEDIA_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${objectKey}`;
    }
    return this.storage.presignDownload(objectKey, AVATAR_URL_TTL_S);
  }

  private async toOwnView(p: ProfileRecord, interests: string[]): Promise<OwnProfileView> {
    return {
      accountId: p.accountId,
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      avatarUrl: await this.avatarUrl(p.avatarObjectKey),
      avatarObjectKey: p.avatarObjectKey,
      language: p.language,
      country: p.country,
      timezone: p.timezone,
      interests,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private toPrivacyView(p: PrivacyRecord, band: AgeBand): PrivacySettings {
    const allowed = AGE_BAND_PRIVACY_POLICY[band].allowed;
    const locked = (Object.keys(allowed) as Array<keyof typeof allowed>).filter(
      (k) => allowed[k].length <= 1,
    );
    return {
      profileVisibility: p.profileVisibility,
      locationVisibility: p.locationVisibility,
      challengeInvitesFrom: p.challengeInvitesFrom,
      discoverable: p.discoverable,
      lockedByPolicy: locked,
      updatedAt: p.updatedAt.toISOString(),
    };
  }
}
