"use client";

import { useRouter } from "next/navigation";
import { LiveKitRoom, VideoConference } from "@livekit/components-react";
import "@livekit/components-styles";

export function VideoRoom({
  token,
  serverUrl,
  subject,
}: {
  token: string;
  serverUrl: string;
  roomName: string;
  subject: string;
}) {
  const router = useRouter();

  return (
    <div className="h-screen w-screen" data-lk-theme="default">
      <LiveKitRoom
        token={token}
        serverUrl={serverUrl}
        connect
        audio
        video
        style={{ height: "100%" }}
        onDisconnected={() => router.push("/dashboard")}
      >
        <VideoConference />
      </LiveKitRoom>
      <span className="sr-only">{subject} session</span>
    </div>
  );
}
