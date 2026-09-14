/**
 * Runtime server selection.
 *
 * Which backend the client talks to is normally baked in at build time through
 * `VITE_API_URL` and friends (see `env.ts`). That means pointing the client at
 * a self-hosted instance previously required rebuilding or launching the
 * desktop app with `--force-server`.
 *
 * This module lets the user override the server at runtime instead. The
 * override is stored in `localStorage` (rather than the regular state store)
 * because it has to be readable synchronously, before any of the application
 * state has been hydrated and before the API client is constructed.
 */

export type ServerPreset = {
  /**
   * Stable identifier
   */
  id: string;

  /**
   * Human readable label shown in the server selector
   */
  label: string;

  /**
   * API base URL for this server
   */
  apiUrl: string;
};

/**
 * Servers offered as presets in the server selector.
 *
 * The first entry is treated as the official instance.
 */
export const KNOWN_SERVERS: ServerPreset[] = [
  {
    id: "stoat.chat",
    label: "stoat.chat",
    apiUrl: "https://api.stoat.chat",
  },
  {
    id: "stoat.adriel.eu",
    label: "stoat.adriel.eu",
    apiUrl: "https://stoat.adriel.eu/api",
  },
];

/**
 * localStorage key used to persist the server override
 */
const STORAGE_KEY = "stoat:server";

/**
 * Normalise user input into an API base URL.
 *
 * Accepts a bare hostname ("stoat.adriel.eu"), an origin
 * ("https://stoat.adriel.eu") or a full API URL
 * ("https://stoat.adriel.eu/api") and always returns the latter form.
 *
 * @param input Raw user input
 * @returns API base URL
 */
export function normalizeServerUrl(input: string): string {
  let value = input.trim();

  if (!value) {
    throw new Error("No server address given");
  }

  // assume https:// if no scheme was given
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }

  // drop any trailing slashes
  value = value.replace(/\/+$/, "");

  // the API is conventionally mounted at /api
  if (!/\/api$/i.test(value)) {
    value = `${value}/api`;
  }

  // reject anything that isn't a usable absolute URL with a real host
  const url = new URL(value);
  if (!url.hostname) {
    throw new Error(`Invalid server address: ${input}`);
  }

  return value;
}

/**
 * Check whether the given input is a usable server address.
 * @param input Raw user input
 * @returns Whether it can be used
 */
export function isValidServerUrl(input: string): boolean {
  try {
    normalizeServerUrl(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the runtime server override, if the user has set one.
 * @returns Normalised API base URL or undefined
 */
export function getStoredServerApiUrl(): string | undefined {
  if (typeof localStorage === "undefined") {
    return undefined;
  }

  let stored: string | null = null;

  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage can throw if storage is blocked entirely
    return undefined;
  }

  const value = stored?.trim();
  if (!value) {
    return undefined;
  }

  try {
    return normalizeServerUrl(value);
  } catch {
    return undefined;
  }
}

/**
 * Persist a runtime server override.
 * @param value Raw user input or API base URL
 */
export function setStoredServerApiUrl(value: string) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(STORAGE_KEY, normalizeServerUrl(value));
}

/**
 * Drop the runtime server override, reverting to the build-time default.
 */
export function clearStoredServerApiUrl() {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Replace the path of a URL, keeping scheme and host.
 * @param apiUrl API base URL
 * @param path Path to mount
 * @returns Rewritten URL
 */
function withPath(apiUrl: string, path: string): string {
  const url = new URL(apiUrl);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Derive the events (WebSocket) URL for a self-hosted server.
 * @param apiUrl API base URL
 * @returns WebSocket URL
 */
export function deriveWsUrl(apiUrl: string): string {
  const url = new URL(withPath(apiUrl, "/events"));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

/**
 * Derive the media (Autumn) URL for a self-hosted server.
 * @param apiUrl API base URL
 * @returns Media URL
 */
export function deriveMediaUrl(apiUrl: string): string {
  return withPath(apiUrl, "/autumn");
}

/**
 * Derive the proxy (January) URL for a self-hosted server.
 * @param apiUrl API base URL
 * @returns Proxy URL
 */
export function deriveProxyUrl(apiUrl: string): string {
  return withPath(apiUrl, "/january");
}
