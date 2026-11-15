"use client";

import { VideoRoom as SharedVideoRoom } from "@/components/dashboard/video-room";
import { consentToSessionRecording } from "./recording-consent-action";

export function VideoRoom(props: Omit<React.ComponentProps<typeof SharedVideoRoom>, "consentAction" | "presenceAction">) {
  return <SharedVideoRoom {...props} consentAction={consentToSessionRecording} />;
}
