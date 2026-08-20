import { Show } from "solid-js";

import { CONFIGURATION } from "@revolt/common";
import { Column } from "@revolt/ui";

import { PushToTalkOptions } from "./PushToTalkOptions";
import { ScreenShareOptions } from "./ScreenShareOptions";
import { VoiceInputOptions } from "./VoiceInputOptions";
import { VoiceProcessingOptions } from "./VoiceProcessingOptions";
/**
 * Configure voice options
 */
export function VoiceSettings() {
  return (
    <Column gap="lg">
      <VoiceInputOptions />
      <VoiceProcessingOptions />
      <PushToTalkOptions />
      <Show when={CONFIGURATION.ENABLE_VIDEO}>
        <ScreenShareOptions />
      </Show>
    </Column>
  );
}
