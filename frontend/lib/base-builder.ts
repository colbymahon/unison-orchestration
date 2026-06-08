/** Base.dev Builder Code — ERC-8021 onchain attribution (Settings → Builder Code). */
export const BASE_BUILDER_CODE = "bc_j56e3k4r";

/**
 * Pre-computed `Attribution.toDataSuffix({ codes: [BASE_BUILDER_CODE] })` hex.
 * Append to transaction calldata for web / non–Base-App settlement paths.
 */
export const BASE_BUILDER_DATA_SUFFIX =
  "0x62635f6a353665336b34720b0080218021802180218021802180218021" as const;

export const BASE_BUILDER_ATTRIBUTION = {
  code: BASE_BUILDER_CODE,
  data_suffix: BASE_BUILDER_DATA_SUFFIX,
  standard: "erc-8021",
} as const;
