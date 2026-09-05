/**
 * Permissions architecture placeholder. Every device capability QUEST will ask for is declared
 * here with its purpose string, so requests are purpose-bound and least-privilege (CLAUDE.md rule 8).
 * Real prompts (expo-camera, expo-location, expo-notifications) are added in the phase that needs
 * them; UI must request a permission only in the moment the user takes the action that needs it.
 */
export const PermissionKind = {
  CAMERA: 'CAMERA',
  MEDIA_LIBRARY: 'MEDIA_LIBRARY',
  LOCATION_WHEN_IN_USE: 'LOCATION_WHEN_IN_USE',
  NOTIFICATIONS: 'NOTIFICATIONS',
} as const;
export type PermissionKind = (typeof PermissionKind)[keyof typeof PermissionKind];

export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'blocked';

export interface PermissionPort {
  status(kind: PermissionKind): Promise<PermissionStatus>;
  request(kind: PermissionKind): Promise<PermissionStatus>;
}

/** Purpose strings shown before the OS prompt (and mirrored in Info.plist / AndroidManifest). */
export const permissionPurpose: Record<PermissionKind, string> = {
  CAMERA: 'Capture photo or video evidence for a Quest you are completing.',
  MEDIA_LIBRARY: 'Choose existing photos or videos as Quest evidence.',
  LOCATION_WHEN_IN_USE:
    'Find Quests near you and verify location-based Quests. Precise location is never shared with other users.',
  NOTIFICATIONS: 'Get notified about Quest results, challenges from friends and crew activity.',
};

/** Precise/background location is intentionally absent: it requires a dedicated privacy review (Phase 08). */
export const FORBIDDEN_PERMISSIONS = ['LOCATION_ALWAYS', 'CONTACTS', 'MICROPHONE_ALWAYS'] as const;

/** Phase 00 default: nothing is granted and nothing can be requested (no capability is wired). */
export class NoopPermissions implements PermissionPort {
  status(_kind: PermissionKind): Promise<PermissionStatus> {
    return Promise.resolve('undetermined');
  }
  request(_kind: PermissionKind): Promise<PermissionStatus> {
    return Promise.resolve('denied');
  }
}
