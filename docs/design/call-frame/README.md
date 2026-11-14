# Lesson call frame experiment

The main glass conversation card includes microphone, camera, screen-share and end-call controls in its own footer. The footer follows the same wide-to-compressed transition as the conversation; aligned AI notes remain outside. On narrow screens the footer stays with the conversation, and notes stack underneath.

Microphone, camera and sharing controls toggle illustrative UI states only; no browser device or screen capture is requested. Ending the preview pauses the animation and replaces the toolbar with a replay action. Replay restores the active preview. The earlier separate pause/replay buttons have been removed. The recording cue is a larger 21px icon without visible wording, with an accessible description.

The student colour is muted ink blue (`#7188b8` in light mode, `#a5b6db` in dark mode), applied consistently to the waveform, evidence highlights and speaker portrait outline. The colour token selector explicitly overrides the legacy purple rule. Tutor branding stays green and the verification seal stays blue.

[Light preview](light.webp) · [Dark preview](dark.webp) · [Mobile preview](mobile.webp)

## Verification

Browser checks confirmed the colour values in both themes, no old controls or visible recording text, working device-toggle states, end and replay actions, and the footer staying within the conversation width at 320, 390, 480, 600, 640, 641, 768, 1024, 1100 and 1440px. No horizontal overflow or browser exceptions. See [checks.json](checks.json). All 32 completed-scenario fixtures at the same ten widths passed note/content/toolbar collision and overflow checks: [layout-checks.json](layout-checks.json). TypeScript and whitespace checks pass. These checks cover the sampled interactions and completed layouts, not every intermediate animation frame.

Set `USE_CALL_FRAME` to false in `lesson-signal.tsx` to compare the previous audio-only card. This remains a local, uncommitted experiment.
