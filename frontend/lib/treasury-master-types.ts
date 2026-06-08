export interface MasterTreasuryConfig {
  master_wallet_address: string;
  override_platform_treasury: boolean;
  override_creator_allocations: boolean;
  updated_at: string;
}

export interface MasterTreasuryConfigResponse extends MasterTreasuryConfig {
  config_writable: boolean;
  config_source: "defaults" | "file" | "env";
}
