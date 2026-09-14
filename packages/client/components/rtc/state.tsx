import {
  Accessor,
  batch,
  createContext,
  createEffect,
  createSignal,
  JSX,
  Setter,
  useContext,
} from "solid-js";
import {
  RoomContext,
  TrackReferenceOrPlaceholder,
  useTracks,
} from "solid-livekit-components";

import {
  LocalAudioTrack,
  LocalTrackPublication,
  LocalVideoTrack,
  Room,
  ScreenSharePresets,
  Track,
  VideoEncoding,
  VideoResolution,
} from "livekit-client";
import { Channel } from "stoat.js";

import { SoundController, useSound } from "@revolt/client";
import { useInstance } from "@revolt/instance";
import { ModalController, useModals } from "@revolt/modal";
import { useState } from "@revolt/state";
import {
  NoiseSuppresionState,
  ScreenShareQualityName,
  Voice as VoiceSettings,
} from "@revolt/state/stores/Voice";
import { VoiceCallCardContext } from "@revolt/ui/components/features/voice/callCard/VoiceCallCard";

import { Device, useDevice } from "@revolt/common";
import { InRoom } from "./components/InRoom";
import { RoomAudioManager } from "./components/RoomAudioManager";
import { VoiceProcessor } from "./VoiceProcessor";

type State =
  | "READY"
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING";

type ScreenShareQuality = {
  name: ScreenShareQualityName;
  resolution: VideoResolution;
  /** Encoding and degradation controls prevent 30fps capture from being sent at LiveKit's 15fps default. */
  encoding: VideoEncoding;
  degradationPreference: RTCDegradationPreference;
  fullName: string;
  contentHint: string;
};

class Voice {
  #settings: VoiceSettings;

  channel: Accessor<Channel | undefined>;
  #setChannel: Setter<Channel | undefined>;

  room: Accessor<Room | undefined>;
  #setRoom: Setter<Room | undefined>;

  vidTracks: Accessor<TrackReferenceOrPlaceholder[]>;

  state: Accessor<State>;
  #setState: Setter<State>;

  deafen: Accessor<boolean>;
  microphone: Accessor<boolean>;

  video: Accessor<boolean>;
  #setVideo: Setter<boolean>;

  screenshare: Accessor<boolean>;
  #setScreenshare: Setter<boolean>;

  fullscreen: Accessor<boolean>;
  #setFullscreen: Setter<boolean>;

  focusId: Accessor<string | undefined>;
  #setFocus: Setter<string | undefined>;

  showBar: Accessor<boolean>;
  #setShowBar: Setter<boolean>;

  /** Whether the desktop shell successfully bound the global PTT key. */
  globalPushToTalk: Accessor<boolean>;
  #setGlobalPushToTalk: Setter<boolean>;
  #pttReleaseTimer: ReturnType<typeof setTimeout> | undefined;

  private sound: SoundController;
  private device: Device;

  private openModal;
  private config;
  private limits;
  private screenShareTracks: Set<string>;
  private voiceProcessor?: VoiceProcessor;

  constructor(
    voiceSettings: VoiceSettings,
    modals: ModalController,
    sound: SoundController,
    device: Device,
  ) {
    this.#settings = voiceSettings;
    this.sound = sound;
    this.device = device;

    const [channel, setChannel] = createSignal<Channel>();
    this.channel = channel;
    this.#setChannel = setChannel;

    const [room, setRoom] = createSignal<Room>();
    this.room = room;
    this.#setRoom = setRoom;

    this.vidTracks = () => [];

    const [state, setState] = createSignal<State>("READY");
    this.state = state;
    this.#setState = setState;

    this.deafen = () => voiceSettings.deafen;
    this.microphone = () => voiceSettings.micOn && !voiceSettings.deafen;

    const [globalPushToTalk, setGlobalPushToTalk] = createSignal(false);
    this.globalPushToTalk = globalPushToTalk;
    this.#setGlobalPushToTalk = setGlobalPushToTalk;
    this.#bindPushToTalk();

    const [video, setVideo] = createSignal(false);
    this.video = video;
    this.#setVideo = setVideo;

    const [screenshare, setScreenshare] = createSignal(false);
    this.screenshare = screenshare;
    this.#setScreenshare = setScreenshare;

    const [fullscreen, setFullscreen] = createSignal(false);
    this.fullscreen = fullscreen;
    this.#setFullscreen = setFullscreen;

    const [focus, setFocus] = createSignal<string>();
    this.focusId = focus;
    this.#setFocus = setFocus;

    const [showBar, setShowBar] = createSignal(true);
    this.showBar = showBar;
    this.#setShowBar = setShowBar;

    const inst = useInstance();
    this.config = inst.config;
    this.limits = inst.limits;
    this.openModal = modals.openModal;

    this.screenShareTracks = new Set();

    // Setup settings listeners
    this.settingsListeners();
  }

  // Dynamically set echo cancellation and gain control when the settings are changed
  // These functions are needed to maintain reactivity. Don't ask me why but if you make them not functions it breaks.
  private settingsListeners() {
    const getSettings = () => this.#settings;

    const setEchoCancellation = (echoCancellation: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.echoCancellation = echoCancellation;
      }
    };

    const setAutoGainControl = (autoGainControl: boolean) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.constraints.autoGainControl = autoGainControl;
      }
    };

    const setNoiseSuppression = (noiseSuppression: NoiseSuppresionState) => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        if (noiseSuppression === "browser") {
          track.constraints.noiseSuppression = true;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = true;
        } else {
          track.constraints.noiseSuppression = false;
          //@ts-expect-error voiceIsolation is not yet standard, but it supported by livekit and most chromium based browsers, including electron.
          track.constraints.voiceIsolation = false;
        }
      }
    };

    const restartTrack = () => {
      const track = this.getMicrophoneTrack()?.audioTrack;
      if (track) {
        track.restartTrack();
      }
    };

    createEffect(() => {
      setEchoCancellation(getSettings().echoCancellation ?? true);
      setAutoGainControl(getSettings().autoGainControl ?? true);
      setNoiseSuppression(getSettings().noiseSupression ?? "browser");
      restartTrack();
    });
  }

  async connect(channel: Channel, auth?: { url: string; token: string }) {
    this.disconnect();

    this.device.setWakeLocked();

    const room = new Room({
      audioCaptureDefaults: {
        deviceId: this.#settings.preferredAudioInputDevice,
        echoCancellation: this.#settings.echoCancellation,
        noiseSuppression: this.#settings.noiseSupression === "browser",
        autoGainControl: this.#settings.autoGainControl,
        voiceIsolation: this.#settings.noiseSupression === "browser",
      },
      audioOutput: {
        deviceId: this.#settings.preferredAudioOutputDevice,
      },
      videoCaptureDefaults: {
        resolution: {
          width: 1280,
          height: 720,
          frameRate: 30,
        },
        deviceId: this.#settings.preferredVideoDevice,
      },
    });

    this.vidTracks = useTracks(
      [
        { source: Track.Source.Camera, withPlaceholder: true },
        { source: Track.Source.ScreenShare, withPlaceholder: false },
      ],
      { room, onlySubscribed: false },
    );

    batch(() => {
      this.#setRoom(room);
      this.#setChannel(channel);
      this.#setState("CONNECTING");
      this.#setVideo(false);
      this.#setScreenshare(false);
    });

    room.addListener("connected", () => {
      this.#setState("CONNECTED");
      if (this.speakingPermission)
        room.localParticipant
          .setMicrophoneEnabled(this.#settings.micOn)
          .then((track) => {
            this.#settings.micOn = track != null;
            // Keep the already-published track muted until the PTT key is held.
            if (this.#settings.pushToTalk) void this.applyPushToTalkMode();
          });
      for (const p of room.remoteParticipants.values()) {
        const screenShareTrack = p.getTrackPublication(
          Track.Source.ScreenShare,
        );
        if (screenShareTrack) {
          this.screenShareTracks.add(screenShareTrack.trackSid);
        }
      }
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("disconnected", () => this.#setState("DISCONNECTED"));

    room.addListener("localTrackPublished", (pub) => {
      if (pub.audioTrack && pub.audioTrack.source === Track.Source.Microphone) {
        if (!pub.audioTrack.getProcessor()) {
          pub.audioTrack?.setProcessor(
            (this.voiceProcessor = new VoiceProcessor(this.#settings)),
          );
        }
      }
    });

    room.addListener("participantConnected", () => {
      this.sound.playSound("userJoinVoice");
    });

    room.addListener("participantDisconnected", () => {
      this.sound.playSound("userLeaveVoice");
    });

    room.addListener("trackPublished", (pub) => {
      if (pub.source === Track.Source.ScreenShare) {
        pub.once("subscribed", (track) => {
          // Play the sound once playback starts, which might be quite a bit after subscription
          // as it starts paused for the screen share settings modal.
          track.once("videoPlaybackStarted", () => {
            this.sound.playSound("streamStart");
            if (track.sid) {
              this.screenShareTracks.add(track.sid);
            }
          });
        });
      }
    });

    room.addListener("trackUnpublished", (unpub) => {
      if (this.screenShareTracks.has(unpub.trackSid)) {
        this.sound.playSound("streamEnd");
        this.screenShareTracks.delete(unpub.trackSid);
      }
    });

    // Gather latency
    const selected = await Promise.any(
      this.config.features.livekit.nodes.map(async (node) => {
        return fetch(node.public_url.replace("wss", "https")).then(() => {
          return node.name;
        });
      }),
    );

    if (!auth) {
      auth = await channel.joinCall(selected);
    }

    await room.connect(auth.url, auth.token, {
      autoSubscribe: false,
    });
  }

  disconnect() {
    this.device.releaseWakeLock();
    try {
      const room = this.room();
      if (!room) return;

      room.removeAllListeners();
      room.disconnect();

      batch(() => {
        this.#setState("READY");
        this.#setRoom();
        this.#setChannel();
        this.#setFullscreen(false);
        this.vidTracks = () => [];
      });

      this.screenShareTracks = new Set();

      this.sound.playSound("userLeaveVoice");
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleDeafen(fromMute?: boolean) {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        (this.#settings.micOn || !!fromMute) &&
          !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.deafen = !this.#settings.deafen;
      if (fromMute) {
        this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;
      }
      if (this.#settings.deafen) {
        this.sound.playSound("deafen");
      } else {
        this.sound.playSound("undeafen");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleMute() {
    if (this.#settings.deafen) {
      this.toggleDeafen(true);
      return;
    }
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setMicrophoneEnabled(
        !room.localParticipant.isMicrophoneEnabled,
      );

      this.#settings.micOn = room.localParticipant.isMicrophoneEnabled;

      if (this.#settings.micOn) {
        this.sound.playSound("unmute");
      } else {
        this.sound.playSound("mute");
      }
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleCamera() {
    try {
      const room = this.room();
      if (!room) throw "invalid state";
      await room.localParticipant.setCameraEnabled(
        !room.localParticipant.isCameraEnabled,
      );

      this.#setVideo(room.localParticipant.isCameraEnabled);
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Get the enabled screen share qualities. "low" will always be enabled.
   * Each screen share quality is checked against the limit if the limit is available on the client.
   *
   * TODO: Translate the fullNames here, I can't figure out how to do it.
   *
   * @param name The name of the screen share quality to get
   * @returns A partial record of ScreenShareQualityName to ScreenShareQuality. Will always contain "low" quality.
   */
  getEnabledScreenShareQualities(): Partial<
    Record<ScreenShareQualityName, ScreenShareQuality>
  > {
    // Always enable low
    const qualities: Partial<
      Record<ScreenShareQualityName, ScreenShareQuality>
    > = {
      low: {
        name: "low",
        resolution: ScreenSharePresets.h720fps30.resolution,
        encoding: ScreenSharePresets.h720fps30.encoding,
        degradationPreference: "maintain-framerate",
        fullName: `720p 30FPS`,
        contentHint: "motion",
      },
    };

    const limit = this.limits().video_resolution;

    // TODO: Add more resolutions to stream from if they're enabled. May tie into premium users in the future?
    if (
      (limit[0] === 0 || limit[0] >= 1920) &&
      (limit[1] === 0 || limit[1] >= 1080)
    ) {
      qualities.high = {
        name: "high",
        resolution: ScreenSharePresets.h1080fps30.resolution,
        encoding: ScreenSharePresets.h1080fps30.encoding,
        degradationPreference: "maintain-framerate",
        fullName: `1080p 30FPS`,
        contentHint: "motion",
      };
      const originalResolution = ScreenSharePresets.original.resolution;
      originalResolution.frameRate = 5;
      originalResolution.aspectRatio = 0;

      const limit = this.limits().video_resolution;
      originalResolution.width = limit[0];
      originalResolution.height = limit[1];
      // If both resolutions are limited, set aspect ratio
      if (originalResolution.height !== 0 && originalResolution.width !== 0) {
        originalResolution.aspectRatio =
          originalResolution.width / originalResolution.height;
      }

      qualities.text = {
        name: "text",
        resolution: originalResolution,
        encoding: {
          ...ScreenSharePresets.original.encoding,
          maxFramerate: 5,
        },
        degradationPreference: "maintain-resolution",
        fullName: `Source 5FPS`,
        contentHint: "text",
      };
    }

    return qualities;
  }

  /** Apply the selected screen-share encoding after the desktop picker resolves. */
  async #applyScreenShareEncoding(
    track: LocalVideoTrack,
    quality: ScreenShareQuality,
  ) {
    try {
      await track.setDegradationPreference(quality.degradationPreference);
      const sender = track.sender;
      if (!sender) return;
      const params = sender.getParameters();
      if (!params.encodings?.length) return;
      for (const encoding of params.encodings) {
        if (encoding.active === false) continue;
        const scale = encoding.scaleResolutionDownBy ?? 1;
        encoding.maxFramerate = quality.encoding.maxFramerate;
        encoding.maxBitrate = Math.round(
          quality.encoding.maxBitrate / (scale * scale),
        );
      }
      await sender.setParameters(params);
    } catch (e) {
      console.error("[screenshare] could not apply encoding", e);
    }
  }

  /** Find the desktop shell's PipeWire loopback source, if available. */
  async #findLoopbackSource(): Promise<string | undefined> {
    if (!window.native) return undefined;
    try {
      return (await navigator.mediaDevices.enumerateDevices()).find(
        (device) =>
          device.kind === "audioinput" &&
          device.label.includes("stoat-virtual-source"),
      )?.deviceId;
    } catch {
      return undefined;
    }
  }

  async #publishLoopbackAudio(room: Room, deviceId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });
    const [mediaStreamTrack] = stream.getAudioTracks();
    if (!mediaStreamTrack) return;
    await room.localParticipant.publishTrack(
      new LocalAudioTrack(mediaStreamTrack),
      {
        source: Track.Source.ScreenShareAudio,
      },
    );
  }

  async #unpublishScreenAudio(room: Room) {
    const publication = room.localParticipant.getTrackPublication(
      Track.Source.ScreenShareAudio,
    );
    if (!publication?.track) return;
    try {
      publication.track.stop();
      await room.localParticipant.unpublishTrack(publication.track);
    } catch (e) {
      this.onErr(e);
    }
  }

  async toggleScreenshare() {
    const room = this.room();
    if (!room) throw "invalid state";

    if (this.screenshare()) {
      await this.#unpublishScreenAudio(room);
      await room.localParticipant.setScreenShareEnabled(false);

      this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

      this.sound.playSound("streamEnd");
    } else {
      const qualities = this.getEnabledScreenShareQualities();
      let screenPickerQualityName: ScreenShareQualityName | undefined;
      let screenPickerAudio: boolean | undefined;

      // Register the modal on screen picker handler if it exists
      if (window.native && window.native.onceScreenPicker) {
        window.native.onceScreenPicker((sources) => {
          this.openModal({
            type: "screen_share_picker",
            onCancel: () => {
              window.native.screenPickerCallback(-1, false);
            },
            callback: (
              idx: number,
              qualityName: ScreenShareQualityName,
              audio: boolean,
            ) => {
              window.native.screenPickerCallback(idx, audio);
              screenPickerQualityName = qualityName;
              screenPickerAudio = audio;
            },
            sources: sources,
            qualities: Object.keys(qualities).map((k) => {
              const v = qualities[k as ScreenShareQualityName]!;
              return { name: k, fullName: v.fullName };
            }),
          });
        });
      }

      const loopbackDeviceId = await this.#findLoopbackSource();
      // Electron reports the pick after capture begins; start native sharing at
      // the highest permitted preset, then immediately apply the selection.
      const publishQuality = window.native
        ? (qualities.high ?? qualities.low!)
        : (qualities[this.#settings.screenShareQuality || "low"] ??
          qualities.low!);

      try {
        const localTrack = await room.localParticipant.setScreenShareEnabled(
          true,
          {
            resolution: publishQuality.resolution,
            audio: loopbackDeviceId
              ? false
              : {
                  autoGainControl: false,
                  echoCancellation: false,
                  noiseSuppression: false,
                  voiceIsolation: false,
                  restrictOwnAudio: true,
                },
          },
          {
            screenShareEncoding: publishQuality.encoding,
            degradationPreference: publishQuality.degradationPreference,
          },
        );

        if (loopbackDeviceId) {
          try {
            await this.#publishLoopbackAudio(room, loopbackDeviceId);
          } catch (e) {
            this.onErr(e);
          }
        }

        const screenAudioTrack = room.localParticipant.getTrackPublication(
          Track.Source.ScreenShareAudio,
        );

        this.#setScreenshare(room.localParticipant.isScreenShareEnabled);

        if (localTrack) {
          // This event is only fired if the screen share is ended by closing the window being streamed.
          // This catches the ending and disables screen sharing on our side. If this weren't here,
          // livekit would still share stream audio after closing the window being streamed.
          localTrack.on("ended", () => {
            this.toggleScreenshare();
            const oldAudioTrack = room.localParticipant.getTrackPublication(
              Track.Source.ScreenShareAudio,
            );
            if (oldAudioTrack && oldAudioTrack.track) {
              room.localParticipant.unpublishTrack(oldAudioTrack.track);
            }
          });

          const callback = async (
            qualityName: ScreenShareQualityName,
            audio: boolean,
          ) => {
            const quality = qualities[qualityName] || qualities.low!;

            if (localTrack.videoTrack) {
              await localTrack.videoTrack.mediaStreamTrack.applyConstraints({
                frameRate: { max: quality.resolution.frameRate },
                width:
                  quality.resolution.width === 0
                    ? undefined
                    : {
                        ideal: quality.resolution.width,
                        max: quality.resolution.width,
                      },
                height:
                  quality.resolution.width === 0
                    ? undefined
                    : {
                        ideal: quality.resolution.width,
                        max: quality.resolution.height,
                      },
              });
              localTrack.videoTrack.mediaStreamTrack.contentHint =
                quality.contentHint;
              await this.#applyScreenShareEncoding(
                localTrack.videoTrack,
                quality,
              );
              if (!audio && screenAudioTrack?.track) {
                room.localParticipant.unpublishTrack(screenAudioTrack.track);
              }
              this.sound.playSound("streamStart");
            }
          };

          if (screenPickerQualityName) {
            callback(
              screenPickerQualityName || "low",
              screenPickerAudio || false,
            );
          } else if (this.#settings.screenShareQualityAsk) {
            if (Object.keys(qualities).length > 1) {
              localTrack.pauseUpstream();
              screenAudioTrack?.pauseUpstream();
              this.openModal({
                onCancel: async () => {
                  await room.localParticipant.setScreenShareEnabled(false);
                  this.#setScreenshare(
                    room.localParticipant.isScreenShareEnabled,
                  );
                },
                type: "screen_share_settings",
                trackReference: {
                  participant: room.localParticipant,
                  publication: localTrack,
                  source: Track.Source.ScreenShare,
                },
                qualities: Object.keys(qualities).map((k) => {
                  const v = qualities[k as ScreenShareQualityName]!;
                  return { name: k, fullName: v.fullName };
                }),
                audio: !!screenAudioTrack,
                callback: async (qualityName, audio) => {
                  callback(qualityName, audio);
                  localTrack.resumeUpstream();
                  if (audio) {
                    screenAudioTrack?.resumeUpstream();
                  }
                },
              });
            } else {
              callback(
                this.#settings.screenShareQuality || "low",
                this.#settings.screenShareAudio,
              );
            }
          }
        }
      } catch (e) {
        this.onErr(e);
      }
    }
  }

  toggleFullscreen(fullscreen: boolean = !this.fullscreen()) {
    this.#setFullscreen(fullscreen);
  }

  trackId(t: TrackReferenceOrPlaceholder) {
    return `${t.source}_${t.participant.sid}`;
  }

  toggleFocus(t?: TrackReferenceOrPlaceholder) {
    const id = t ? this.trackId(t) : undefined;
    this.#setFocus(
      this.focusId() === id || this.vidTracks().length < 2 ? undefined : id,
    );
  }

  isFocus(t: TrackReferenceOrPlaceholder) {
    return this.trackId(t) === this.focusId();
  }

  focusTrack() {
    const id = this.focusId();
    return id
      ? this.vidTracks().find((t) => this.trackId(t) === id)
      : undefined;
  }

  toggleShowBar() {
    this.#setShowBar((s) => !s);
  }

  getConnectedUser(userId: string) {
    return this.room()?.getParticipantByIdentity(userId);
  }

  showCard(channel: Channel) {
    return (
      channel.isVoice &&
      (this.channel()?.id === channel.id ||
        channel.type === "TextChannel" ||
        !!channel.voiceParticipants.size)
    );
  }

  getMicrophoneTrack(): LocalTrackPublication | undefined {
    const track = this.room()?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    );
    return track;
  }

  get listenPermission() {
    return !!this.channel()?.havePermission("Listen");
  }

  get speakingPermission() {
    return !!this.channel()?.havePermission("Speak");
  }

  /**
   * Wire up push-to-talk input sources.
   *
   * Two of them: DOM key events, which only fire while the app is focused, and
   * an optional hook from the desktop shell that works globally (while a game
   * has focus). Both funnel into setPushToTalkActive, which is idempotent, so
   * it is fine for both to fire for the same press.
   *
   * Attached once for the lifetime of the app rather than per call: the
   * handlers no-op unless push-to-talk is enabled and a room is connected.
   */
  #bindPushToTalk() {
    if (typeof window === "undefined") return;

    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.isContentEditable ||
        el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        el.tagName === "SELECT"
      );
    };

    window.addEventListener("keydown", (event) => {
      if (!this.#settings.pushToTalk) return;
      if (event.code !== this.#settings.pushToTalkKey) return;
      // Holding a key autorepeats; only the first press matters.
      if (event.repeat) return;
      // Don't swallow the key while someone is writing a message.
      if (isTyping(event.target)) return;
      this.setPushToTalkActive(true);
    });

    window.addEventListener("keyup", (event) => {
      if (!this.#settings.pushToTalk) return;
      if (event.code !== this.#settings.pushToTalkKey) return;
      this.setPushToTalkActive(false);
    });

    // If focus is lost mid-press the keyup never arrives and the mic would
    // stay open indefinitely -- exactly the situation push-to-talk exists to
    // prevent. Alt-tabbing into a game does this every time.
    window.addEventListener("blur", () => {
      if (!this.#settings.pushToTalk) return;
      this.setPushToTalkActive(false);
    });

    window.native?.pushToTalk?.onChange((pressed) =>
      this.setPushToTalkActive(pressed),
    );

    // Arm the global hook at startup rather than on the first call: the key
    // has to be watched before the first press, and the settings page can only
    // tell the truth about global capture once the shell has answered.
    if (window.native?.pushToTalk) this.syncPushToTalkBinding();
  }

  /**
   * Whether the desktop shell can deliver key events while unfocused
   */
  get hasGlobalPushToTalk(): boolean {
    return !!window.native?.pushToTalk;
  }

  /**
   * Ask the desktop shell to bind the configured key globally.
   *
   * The shell answers whether it could actually watch the key -- it says no
   * when the backend is missing, the key is one it cannot map, or the OS
   * withheld permission (macOS Accessibility). That answer is kept so the
   * settings page can say which of "works everywhere" and "focused only" is
   * true, instead of assuming the desktop app always manages it.
   */
  async syncPushToTalkBinding(): Promise<boolean> {
    const binding = window.native?.pushToTalk;
    if (!binding) {
      this.#setGlobalPushToTalk(false);
      return false;
    }
    try {
      const bound = await binding.setBinding(
        this.#settings.pushToTalk ? this.#settings.pushToTalkKey : "",
      );
      // Unbinding reports whether the backend is alive, not whether we are
      // armed, so only believe it when we asked for a key.
      this.#setGlobalPushToTalk(this.#settings.pushToTalk && bound);
      return bound;
    } catch (e) {
      this.onErr(e);
      this.#setGlobalPushToTalk(false);
      return false;
    }
  }

  /**
   * The published microphone track, if there is one
   */
  #micTrack() {
    return this.room()?.localParticipant.getTrackPublication(
      Track.Source.Microphone,
    )?.track;
  }

  /**
   * Start or stop transmitting.
   *
   * Mutes the already-published track rather than going through
   * setMicrophoneEnabled, which renegotiates -- far too slow to sit between
   * pressing a key and the first syllable.
   */
  async #setTransmitting(on: boolean) {
    try {
      const track = this.#micTrack();
      if (!track) {
        // Nothing published yet (e.g. mic was hard-muted). Publishing on the
        // first press is slower but better than dropping the press entirely.
        if (on) await this.room()?.localParticipant.setMicrophoneEnabled(true);
        return;
      }
      await (on ? track.unmute() : track.mute());
    } catch (e) {
      this.onErr(e);
    }
  }

  /**
   * Called on key press (true) and release (false)
   */
  async setPushToTalkActive(active: boolean) {
    if (!this.#settings.pushToTalk) return;
    if (!this.room() || !this.speakingPermission) return;
    // Deafened means silent regardless of what is held down.
    if (this.#settings.deafen) return;

    if (this.#pttReleaseTimer) {
      clearTimeout(this.#pttReleaseTimer);
      this.#pttReleaseTimer = undefined;
    }

    if (active) {
      await this.#setTransmitting(true);
      return;
    }

    const delay = this.#settings.pushToTalkReleaseDelay;
    if (delay > 0) {
      this.#pttReleaseTimer = setTimeout(() => {
        this.#pttReleaseTimer = undefined;
        this.#setTransmitting(false);
      }, delay);
    } else {
      await this.#setTransmitting(false);
    }
  }

  /**
   * Bring the mic in line with the push-to-talk setting.
   *
   * When enabled the track stays published but muted, so a press only has to
   * flip the mute flag. Call after connecting or after toggling the setting.
   */
  async applyPushToTalkMode() {
    // Bind first: the key hook has nothing to do with being in a call, and
    // toggling the setting outside one still has to arm it (and report back).
    await this.syncPushToTalkBinding();

    const room = this.room();
    if (!room || !this.speakingPermission) return;

    if (this.#settings.pushToTalk) {
      if (!this.#micTrack()) {
        await room.localParticipant.setMicrophoneEnabled(true);
      }
      await this.#setTransmitting(false);
    } else if (this.#settings.micOn && !this.#settings.deafen) {
      await this.#setTransmitting(true);
    }
  }

  private onErr(e: unknown) {
    if ((e as Error).name !== "NotAllowedError")
      this.openModal({ type: "error2", error: e });
  }
}

const voiceContext = createContext<Voice>(null as unknown as Voice);

/**
 * Mount global voice context and room audio manager
 */
export function VoiceContext(props: { children: JSX.Element }) {
  const state = useState();
  const modals = useModals();
  const sound = useSound();
  const device = useDevice();
  const voice = new Voice(state.voice, modals, sound, device);

  return (
    <voiceContext.Provider value={voice}>
      <RoomContext.Provider value={voice.room}>
        <VoiceCallCardContext>{props.children}</VoiceCallCardContext>
        <InRoom>
          <RoomAudioManager />
        </InRoom>
      </RoomContext.Provider>
    </voiceContext.Provider>
  );
}

export const useVoice = () => useContext(voiceContext);
