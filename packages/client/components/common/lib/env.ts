import {
  deriveMediaUrl,
  deriveProxyUrl,
  deriveWsUrl,
  getStoredServerApiUrl,
} from "./server";

export const STOAT_HOST = "stoat.chat";
const STOAT_API = "https://api.stoat.chat";

/** App `stoat.json` endpoint format */
export interface AppConfig {
  api: string;
}

/**
 * Fetch an injected environment value, optionally only while developing.
 * Keeping this indirection prevents Docker's runtime replacement values from
 * being optimized out of the bundle.
 */
const getEnv = (name: string, devOnly?: boolean) =>
  !devOnly || import.meta.env.DEV
    ? (import.meta.env[name] as string)
    : undefined;

/** Pick the first non-blank configured value. */
function firstConfigured(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/** If host is Stoat, normalize to STOAT_HOST, else return host */
export const normalizeHost = (host: string) =>
  [
    "api.revolt.chat",
    "beta.revolt.chat",
    "revolt.chat",
    "api.stoat.chat",
    "beta.stoat.chat",
  ].includes(host)
    ? STOAT_HOST
    : host;

const isStoatOfficialAPI = (api: string) =>
  [
    "https://api.revolt.chat",
    "https://api.stoat.chat",
    "https://stoat.chat/api",
    "https://beta.stoat.chat/api",
    "canary-api.stoat.chat",
  ].includes(api);

const DEFAULT_HOST = normalizeHost(
  getEnv("VITE_DEV_HOST", true) || getEnv("VITE_HOST") || STOAT_HOST,
);

/** Addresses baked into the build, before any runtime server selection. */
const ENV_API_URL = firstConfigured(
  getEnv("VITE_DEV_API_URL", true),
  getEnv("VITE_API_URL"),
  STOAT_API,
);
const ENV_WS_URL = firstConfigured(
  getEnv("VITE_DEV_WS_URL", true),
  getEnv("VITE_WS_URL"),
  "wss://api.stoat.chat/events",
);
const ENV_MEDIA_URL = firstConfigured(
  getEnv("VITE_DEV_MEDIA_URL", true),
  getEnv("VITE_MEDIA_URL"),
  "https://cdn.stoatusercontent.com",
);
const ENV_PROXY_URL = firstConfigured(
  getEnv("VITE_DEV_PROXY_URL", true),
  getEnv("VITE_PROXY_URL"),
  "https://proxy.stoatusercontent.com",
);

if (!isStoatOfficialAPI(ENV_API_URL) && DEFAULT_HOST === STOAT_HOST)
  console.error("VITE_HOST required when VITE_API_URL is set!");

const RUNTIME_API_URL = getStoredServerApiUrl();
const IS_CUSTOM_SERVER =
  RUNTIME_API_URL !== undefined && RUNTIME_API_URL !== ENV_API_URL;
const DEFAULT_API_URL = RUNTIME_API_URL ?? ENV_API_URL;

function deriveOrFallback(
  derive: (apiUrl: string) => string,
  fallback: string,
): string {
  if (!IS_CUSTOM_SERVER) return fallback;
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
  /** Default instance (without the protocol) */
  DEFAULT_HOST,
  /** API URL of the selected server */
  DEFAULT_API_URL,
  /** Whether the user selected a runtime server override */
  IS_CUSTOM_SERVER,
  /** Whether this is an official Stoat server */
  IS_STOAT: isStoatOfficialAPI(DEFAULT_API_URL),
  /** Derived companion endpoints for runtime-server consumers */
  DEFAULT_WS_URL,
  DEFAULT_MEDIA_URL,
  DEFAULT_PROXY_URL,
  /** Development endpoint overrides retained by the 0.15 client bootstrap. */
  DEV_WS_URL: getEnv("VITE_DEV_WS_URL"),
  DEV_MEDIA_URL: getEnv("VITE_DEV_MEDIA_URL"),
  DEV_PROXY_URL: getEnv("VITE_DEV_PROXY_URL"),
  DEV_GIFBOX_URL: getEnv("VITE_DEV_GIFBOX_URL"),
  RNNOISE_WORKLET_CDN_URL: getEnv("VITE_RNNOISE_WORKLET_CDN_URL"),
  DEVELOPMENT_SESSION_ID: getEnv("VITE_SESSION_ID", true),
  DEVELOPMENT_TOKEN: getEnv("VITE_TOKEN", true),
  DEVELOPMENT_USER_ID: getEnv("VITE_USER_ID", true),
};
