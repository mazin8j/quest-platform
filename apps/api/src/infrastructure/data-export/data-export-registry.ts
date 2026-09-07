import type { DataExportContributor, DataExportRegistryPort } from './data-export.port';

export class InMemoryDataExportRegistry implements DataExportRegistryPort {
  private readonly items = new Map<string, DataExportContributor>();

  register(contributor: DataExportContributor): void {
    if (this.items.has(contributor.context)) {
      throw new Error(`Data export contributor already registered for ${contributor.context}`);
    }
    this.items.set(contributor.context, contributor);
  }

  contributors(): ReadonlyArray<DataExportContributor> {
    return [...this.items.values()];
  }
}
