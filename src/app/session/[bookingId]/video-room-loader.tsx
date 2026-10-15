"use client";

import dynamic from "next/dynamic";
import type { VideoRoom } from "./video-room";

type VideoRoomProps = React.ComponentProps<typeof VideoRoom>;

const DeferredVideoRoom = dynamic(
  () => import("./video-room").then((module) => module.VideoRoom),
  {
    ssr: false,
    loading: () => <div className="flex min-h-[60vh] items-center justify-center text-sm text-muted-foreground">Preparing your lesson room…</div>,
  },
);

export function VideoRoomLoader(props: VideoRoomProps) {
  return <DeferredVideoRoom {...props} />;
}
