import { RoomServiceClient } from "livekit-server-sdk";
import { createClient } from "@/lib/supabase/server";
import { roomNameForBooking } from "@/lib/livekit";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  const { bookingId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, student_id, tutor_id, status, started_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking || booking.student_id !== user.id || booking.status !== "scheduled" || !booking.started_at) {
    return Response.json({ error: "Session not available" }, { status: 404 });
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL;
  if (!apiKey || !apiSecret || !url) return Response.json({ error: "Video is not configured" }, { status: 503 });

  try {
    const host = url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
    const room = await new RoomServiceClient(host, apiKey, apiSecret).listParticipants(roomNameForBooking(booking.id));
    return Response.json({ tutorPresent: room.some((participant) => participant.identity === booking.tutor_id) });
  } catch (error) {
    // LiveKit returns an error while the room has not been created yet. The
    // client treats this as a waiting state and retries until the tutor joins.
    console.warn("Could not check tutor presence:", error);
    return Response.json({ tutorPresent: false });
  }
}
