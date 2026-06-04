import type { Metadata } from "next";

/** Base.org App Setup — immutable homepage verification (no runtime mutation). */
export const BASE_APP_ID = "6a1a76c711d30a39b5246d95";

export const BASE_APP_VERIFICATION_METADATA: Metadata = {
  other: {
    "base:app_id": BASE_APP_ID,
  },
};
