import { Show, createSignal, onCleanup } from "solid-js";

import { Trans } from "@lingui-solid/solid/macro";

import { useVoice } from "@revolt/rtc";
import { useState } from "@revolt/state";
import { CategoryButton, Checkbox, Column, Slider, Text } from "@revolt/ui";

/**
 * Turn a KeyboardEvent.code into something worth showing a human.
 * "AltLeft" -> "Alt Left", "KeyV" -> "V", "Space" -> "Space".
 */
function prettyKey(code: string): string {
  if (!code) return "None";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  return code.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/**
 * Push to talk options
 */
export function PushToTalkOptions() {
  const { voice } = useState();
  const rtc = useVoice();

  const [listening, setListening] = createSignal(false);

  /**
   * Capture the next key press as the new binding.
   *
   * Uses `code` rather than `key` so the binding is physical-position based:
   * it keeps working regardless of keyboard layout, and modifiers like Alt
   * report a usable code where `key` would just be "Alt".
   */
  function captureKey() {
    if (listening()) return;
    setListening(true);

    const finish = (code?: string) => {
      window.removeEventListener("keydown", onKey, true);
      setListening(false);
      if (code) {
        voice.pushToTalkKey = code;
        rtc.syncPushToTalkBinding();
      }
    };

    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      // Escape aborts without rebinding, otherwise you can never back out.
      finish(event.code === "Escape" ? undefined : event.code);
    };

    window.addEventListener("keydown", onKey, true);
    onCleanup(() => window.removeEventListener("keydown", onKey, true));
  }

  return (
    <Column>
      <Text class="title">
        <Trans>Push to Talk</Trans>
      </Text>
      <CategoryButton.Group>
        <CategoryButton
          icon="blank"
          action={<Checkbox checked={voice.pushToTalk} />}
          onClick={() => {
            voice.pushToTalk = !voice.pushToTalk;
            rtc.applyPushToTalkMode();
          }}
          description={
            <Show
              when={rtc.hasGlobalPushToTalk}
              fallback={
                <Trans>
                  Only works while Stoat is focused. Install the desktop app for
                  push to talk that works while playing a game.
                </Trans>
              }
            >
              <Trans>Works even while another window is focused.</Trans>
            </Show>
          }
        >
          <Trans>Enable Push to Talk</Trans>
        </CategoryButton>
        <CategoryButton
          icon="blank"
          action={
            <Text>
              <Show when={!listening()} fallback={<Trans>Press a key…</Trans>}>
                {prettyKey(voice.pushToTalkKey)}
              </Show>
            </Text>
          }
          onClick={captureKey}
        >
          <Trans>Keybind</Trans>
        </CategoryButton>
      </CategoryButton.Group>

      <Text class="label">
        <Trans>Release Delay</Trans>
      </Text>
      <Slider
        min={0}
        max={1000}
        step={50}
        value={voice.pushToTalkReleaseDelay}
        onInput={(event) =>
          (voice.pushToTalkReleaseDelay = event.currentTarget.value)
        }
        labelFormatter={(label) => label.toFixed(0) + "ms"}
      />
    </Column>
  );
}
