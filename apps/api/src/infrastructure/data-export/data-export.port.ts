import type { DataExportSection } from '@quest/types';

/**
 * User-data export contract. Every bounded context that stores account-linked data registers a
 * contributor; the export job assembles their sections into one bundle (@quest/types
 * `dataExportBundleSchema`). Contributors return only data belonging to the account.
 */
export interface DataExportContributor {
  readonly context: string;
  readonly schemaVersion: number;
  exportAccountData(accountId: string): Promise<DataExportSection['data']>;
}

export interface DataExportRegistryPort {
  register(contributor: DataExportContributor): void;
  contributors(): ReadonlyArray<DataExportContributor>;
}
export const DATA_EXPORT_REGISTRY = Symbol('DATA_EXPORT_REGISTRY');
