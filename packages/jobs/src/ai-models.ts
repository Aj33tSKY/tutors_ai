import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";

/**
 * Which model serves a request depends on the credentials present, so no hosting platform is assumed.
 *
 *  - `OPENAI_API_KEY`: talk to OpenAI directly. Nothing else is required.
 *  - otherwise: route through the Vercel AI Gateway (needs `AI_GATEWAY_API_KEY` outside Vercel).
 *
 * The embedding column is vector(768). OpenAI's text-embedding-3 models accept `dimensions`, so the direct
 * path returns 768 values. Nothing queries these vectors by similarity today (chat reads excerpts by
 * booking), so switching embedding providers does not change behaviour; if similarity search is added,
 * re-embed stored content so every row comes from one model.
 */
export const CHAT_MODEL_NAME = "gpt-5.4-nano";
export const EMBEDDING_DIMENSIONS = 768;
const openai = () => process.env.OPENAI_API_KEY ? createOpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export const aiConfigured = () => Boolean(process.env.OPENAI_API_KEY || process.env.AI_GATEWAY_API_KEY);
export function languageModel(): LanguageModel {
  return openai()?.(CHAT_MODEL_NAME) ?? `openai/${CHAT_MODEL_NAME}`;
}
export function embeddingModel(): { model: EmbeddingModel; providerOptions?: { openai: { dimensions: number } } } {
  const direct = openai();
  return direct
    ? { model: direct.embedding("text-embedding-3-small"), providerOptions: { openai: { dimensions: EMBEDDING_DIMENSIONS } } }
    : { model: "google/text-embedding-005" };
}
