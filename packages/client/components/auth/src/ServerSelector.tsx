import { For, Show, createSignal } from "solid-js";

import { Trans, useLingui } from "@lingui-solid/solid/macro";
import localforage from "localforage";
import { styled } from "styled-system/jsx";

import {
  CONFIGURATION,
  KNOWN_SERVERS,
  clearStoredServerApiUrl,
  getStoredServerApiUrl,
  isValidServerUrl,
  setStoredServerApiUrl,
} from "@revolt/common";

/**
 * Sentinel value for the "custom server" option
 */
const CUSTOM_OPTION = "__custom__";

/**
 * Selector allowing the user to pick which server to connect to.
 *
 * Changing the server invalidates the cached session (it only means something
 * to the server that issued it), so the session is dropped and the page is
 * reloaded to rebuild the API client against the new address.
 */
export function ServerSelector() {
  const { t } = useLingui();

  const stored = getStoredServerApiUrl();
  const current = stored ?? CONFIGURATION.DEFAULT_API_URL;

  const preset = KNOWN_SERVERS.find((server) => server.apiUrl === current);

  const [customMode, setCustomMode] = createSignal(!preset);
  const [customValue, setCustomValue] = createSignal(preset ? "" : current);
  const [invalid, setInvalid] = createSignal(false);

  /**
   * Persist the given server and restart the client
   * @param value Raw user input or API base URL
   */
  async function apply(value: string) {
    setStoredServerApiUrl(value);

    // the existing session belongs to the previous server
    await localforage.removeItem("auth").catch(() => void 0);

    location.reload();
  }

  /**
   * Revert to the server this build was configured with
   */
  async function applyDefault() {
    clearStoredServerApiUrl();
    await localforage.removeItem("auth").catch(() => void 0);
    location.reload();
  }

  /**
   * Handle picking an entry from the dropdown
   * @param event Change event
   */
  function onSelect(event: Event & { currentTarget: HTMLSelectElement }) {
    const value = event.currentTarget.value;

    if (value === CUSTOM_OPTION) {
      setCustomMode(true);
      return;
    }

    setCustomMode(false);

    if (value === CONFIGURATION.DEFAULT_API_URL) {
      void applyDefault();
    } else {
      void apply(value);
    }
  }

  /**
   * Commit whatever the user typed into the custom field
   */
  function commitCustom() {
    const value = customValue().trim();

    if (!value || value === current) {
      setInvalid(false);
      return;
    }

    if (!isValidServerUrl(value)) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    void apply(value);
  }

  return (
    <Container>
      <Label>
        <Trans>Server</Trans>
      </Label>
      <Select
        value={customMode() ? CUSTOM_OPTION : current}
        onChange={onSelect}
        title={current}
      >
        <For each={KNOWN_SERVERS}>
          {(server) => <option value={server.apiUrl}>{server.label}</option>}
        </For>
        <Show when={!preset && !customMode()}>
          <option value={current}>{current}</option>
        </Show>
        <option value={CUSTOM_OPTION}>{t`Custom…`}</option>
      </Select>
      <Show when={customMode()}>
        <CustomInput
          type="text"
          spellcheck={false}
          autocapitalize="none"
          autocomplete="off"
          invalid={invalid()}
          title={invalid() ? t`Not a valid server address` : undefined}
          placeholder={t`e.g. stoat.adriel.eu`}
          value={customValue()}
          onInput={(event) => {
            setInvalid(false);
            setCustomValue(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitCustom();
            }
          }}
          onBlur={commitCustom}
        />
      </Show>
    </Container>
  );
}

const Container = styled("div", {
  base: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.9em",
    minWidth: 0,
  },
});

const Label = styled("span", {
  base: {
    color: "var(--md-sys-color-on-surface-variant)",

    mdDown: {
      display: "none",
    },
  },
});

const Select = styled("select", {
  base: {
    height: "32px",
    maxWidth: "40vw",
    padding: "0 8px",
    cursor: "pointer",

    fontFamily: "inherit",
    fontSize: "inherit",

    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-high)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",

    "&:focus": {
      outline: "none",
      borderColor: "var(--md-sys-color-primary)",
    },
  },
});

const CustomInput = styled("input", {
  base: {
    height: "32px",
    width: "220px",
    maxWidth: "40vw",
    padding: "0 8px",

    fontFamily: "inherit",
    fontSize: "inherit",

    color: "var(--md-sys-color-on-surface)",
    background: "var(--md-sys-color-surface-container-high)",
    border: "1px solid var(--md-sys-color-outline-variant)",
    borderRadius: "var(--borderRadius-md)",

    "&:focus": {
      outline: "none",
      borderColor: "var(--md-sys-color-primary)",
    },
  },
  variants: {
    invalid: {
      true: {
        borderColor: "var(--md-sys-color-error)",

        "&:focus": {
          borderColor: "var(--md-sys-color-error)",
        },
      },
    },
  },
});
