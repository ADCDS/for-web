import {
  deriveMediaUrl,
  deriveProxyUrl,
  deriveWsUrl,
  getStoredServerApiUrl,
} from "./server";

/**
 * Pick the first usable value.
 *
 * Values are not just checked for null/undefined: the Docker image builds with
 * `__VITE_X__` placeholders which `docker/inject.js` replaces with an empty
 * string when the corresponding variable is not set at container startup, so
 * blank values have to fall through to the next candidate as well.
 *
 * @param values Candidate values, in order of preference
 * @returns First non-empty value
 */
function firstConfigured(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

/**
 * Server addresses baked in at build time.
 */
const ENV_API_URL = firstConfigured(
  import.meta.env.DEV ? import.meta.env.VITE_DEV_API_URL : undefined,
  import.meta.env.VITE_API_URL as string,
  "https://stoat.chat/api",
);

const ENV_WS_URL = firstConfigured(
  import.meta.env.DEV ? import.meta.env.VITE_DEV_WS_URL : undefined,
  import.meta.env.VITE_WS_URL as string,
  "wss://stoat.chat/events",
);

const ENV_MEDIA_URL = firstConfigured(
  import.meta.env.DEV ? import.meta.env.VITE_DEV_MEDIA_URL : undefined,
  import.meta.env.VITE_MEDIA_URL as string,
  "https://cdn.stoatusercontent.com",
);

const ENV_PROXY_URL = firstConfigured(
  import.meta.env.DEV ? import.meta.env.VITE_DEV_PROXY_URL : undefined,
  import.meta.env.VITE_PROXY_URL as string,
  "https://proxy.stoatusercontent.com",
);

/**
 * Server the user picked at runtime, if any.
 */
const RUNTIME_API_URL = getStoredServerApiUrl();

/**
 * Whether we are talking to a server other than the build-time default.
 *
 * The official instance serves media and proxy from dedicated CDN hosts, so
 * those addresses can only be derived from the API URL for other servers.
 */
const IS_CUSTOM_SERVER =
  RUNTIME_API_URL !== undefined && RUNTIME_API_URL !== ENV_API_URL;

const DEFAULT_API_URL = RUNTIME_API_URL ?? ENV_API_URL;

/**
 * Derive a companion URL, falling back to the build-time value.
 *
 * A bad override must never be able to take the whole app down, so any failure
 * to parse the selected server just reverts to what was configured at build.
 *
 * @param derive Derivation to attempt
 * @param fallback Build-time value
 * @returns Derived URL, or the fallback
 */
function deriveOrFallback(
  derive: (apiUrl: string) => string,
  fallback: string,
): string {
  if (!IS_CUSTOM_SERVER) {
    return fallback;
  }

  try {
    return derive(DEFAULT_API_URL);
  } catch {
    return fallback;
  }
}

const DEFAULT_WS_URL = deriveOrFallback(deriveWsUrl, ENV_WS_URL);
const DEFAULT_MEDIA_URL = deriveOrFallback(deriveMediaUrl, ENV_MEDIA_URL);
const DEFAULT_PROXY_URL = deriveOrFallback(deriveProxyUrl, ENV_PROXY_URL);

export default {
  /**
   * Whether to emit additional debug information
   */
  DEBUG: import.meta.env.DEV || true,
  /**
   * What API server to connect to by default.
   */
  DEFAULT_API_URL,
  /**
   * Whether this is Stoat
   */
  IS_STOAT: [
    // historically...
    "https://api.revolt.chat",
    "https://beta.revolt.chat/api",
    "https://revolt.chat/api",
    // ... and now:
    "https://stoat.chat/api",
  ].includes(DEFAULT_API_URL),
  /**
   * Whether the user has selected a server other than the build-time default.
   */
  IS_CUSTOM_SERVER,
  /**
   * What WS server to connect to by default.
   */
  DEFAULT_WS_URL,
  /**
   * What media server to connect to by default.
   */
  DEFAULT_MEDIA_URL,
  /**
   * What proxy server to connect to by default.
   */
  DEFAULT_PROXY_URL,
  /**
   * What gifbox server to connect to by default.
   */
  DEFAULT_GIFBOX_URL:
    (import.meta.env.DEV ? import.meta.env.VITE_DEV_GIFBOX_URL : undefined) ??
    (import.meta.env.VITE_GIFBOX_URL as string) ??
    "https://api.gifbox.me",
  /**
   * hCaptcha site key to use if enabled
   */
  HCAPTCHA_SITEKEY: import.meta.env.VITE_HCAPTCHA_SITEKEY as string,
  /**
   * Maximum number of replies a message can have
   */
  MAX_REPLIES: (import.meta.env.VITE_CFG_MAX_REPLIES as number) ?? 5,
  /**
   * Maximum number of attachments a message can have
   */
  MAX_ATTACHMENTS: (import.meta.env.VITE_CFG_MAX_ATTACHMENTS as number) ?? 5,
  /**
   * Maximum number of emoji a server can have
   */
  MAX_EMOJI: (import.meta.env.VITE_CFG_MAX_EMOJI as number) ?? 100,
  /**
   * Max file size allowed for uploads (in bytes)
   * 20 MB = 20 * 1024 * 1024 = 20,971,520 bytes
   * I kinda wonder if this should be a setting, or something fetched from the backend dynamically.
   */
  MAX_FILE_SIZE:
    (import.meta.env.VITE_CFG_MAX_FILE_SIZE as number) ?? 20_000_000,
  /**
   * RNNoise worklet CDN host location. Defaults to blank, which uses the url provided by the livekit-rnnoise-processor package.
   */
  RNNOISE_WORKLET_CDN_URL:
    (import.meta.env.VITE_RNNOISE_WORKLET_CDN_URL as string) ?? "",
  /**
   * Enable video allows the web client to enable video and screensharing
   */
  ENABLE_VIDEO:
    ((import.meta.env.VITE_CFG_ENABLE_VIDEO as string) ?? "").toLowerCase() ==
    "true",
  /**
   * Session ID to set during development.
   */
  DEVELOPMENT_SESSION_ID: import.meta.env.DEV
    ? (import.meta.env.VITE_SESSION_ID as string)
    : undefined,
  /**
   * Token to set during development.
   */
  DEVELOPMENT_TOKEN: import.meta.env.DEV
    ? (import.meta.env.VITE_TOKEN as string)
    : undefined,
  /**
   * User ID to set during development.
   */
  DEVELOPMENT_USER_ID: import.meta.env.DEV
    ? (import.meta.env.VITE_USER_ID as string)
    : undefined,
};
