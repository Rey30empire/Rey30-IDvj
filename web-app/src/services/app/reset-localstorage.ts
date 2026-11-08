export interface WebdataResetFlags {
  keepAppData: boolean
  keepModelsAndConfigs: boolean
  clearWebData?: boolean
}

// Old reset sentinels must not erase resources when upgrading to preference recovery.
export function pruneLocalStorageByFlags(flags: WebdataResetFlags): void {
  void flags
}
