import "server-only";
import { AccessToken } from "livekit-server-sdk";

export function livekitConfigured() {
  return Boolean(
    process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET &&
      process.env.NEXT_PUBLIC_LIVEKIT_URL,
  );
}

/** One room per booking — nobody outside the two participants can be handed a token for it. */
export function roomNameForBooking(bookingId: string) {
  return `booking-${bookingId}`;
}

export async function createParticipantToken(opts: {
  bookingId: string;
  identity: string;
  name: string;
  role: "student" | "tutor";
}) {
  const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!, {
    identity: opts.identity,
    name: opts.name,
    metadata: JSON.stringify({ role: opts.role }),
    ttl: "4h",
  });

  at.addGrant({
    room: roomNameForBooking(opts.bookingId),
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt();
}
