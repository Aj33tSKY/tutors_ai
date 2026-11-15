import { chatRequest } from "../../../../packages/contracts/src/chat";
import { chatTurn } from "../../../../packages/domain/src/chat";
import { AppError } from "../../../../packages/domain/src/errors";
import { legacyContext } from "@/lib/billing-adapter";

export const maxDuration = 30;

// Legacy entry point; the behaviour (atomic allowance, bounded history, grounding, persistence)
// lives in packages/domain/src/chat.ts and is shared with the Hono API.
export async function POST(req: Request) {
  const context = await legacyContext();
  if (!context) return new Response("Unauthorized", { status: 401 });
  const parsed = chatRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("Invalid request", { status: 400 });
  try {
    return await chatTurn(context.client, context.identity, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return new Response(error.code, { status: error.status });
    console.error("Legacy chat failed unexpectedly");
    return new Response("Chat is unavailable", { status: 503 });
  }
}
