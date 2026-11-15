import { AccessToken, RoomServiceClient } from "livekit-server-sdk";

export interface LiveProvider {
  serverUrl: string;
  token(input: { bookingId: string; identity: string; name: string; role: "student" | "tutor" }): Promise<string>;
  tutorPresent(bookingId: string, tutorId: string): Promise<boolean>;
}
export function liveProvider(): LiveProvider | null {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const serverUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!key || !secret || !serverUrl) return null;
  return {
    serverUrl,
    async token(input) {
      const token = new AccessToken(key, secret, { identity: input.identity, name: input.name,
        metadata: JSON.stringify({ role: input.role }), ttl: "4h" });
      token.addGrant({ room: `booking-${input.bookingId}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true });
      return token.toJwt();
    },
    async tutorPresent(bookingId, tutorId) {
      const host = serverUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
      try { return (await new RoomServiceClient(host, key, secret).listParticipants(`booking-${bookingId}`)).some((p) => p.identity === tutorId); }
      catch (error) {
        // Only a room that has not yet been created is a normal waiting state.
        if (error && typeof error === "object" && "code" in error && error.code === "not_found") return false;
        throw error;
      }
    },
  };
}
