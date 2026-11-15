import { z } from "zod";

export const autoChargeInput = z.object({ enabled: z.boolean() }).strict();
export type SavedMethod = { brand: string; last4: string; kind: string };
export type UnpaidLesson = { id: string; start_time: string; amount_gbp_pence: number; stripe_invoice_url: string | null; payment_status: string; lesson_name: string | null };
export type StudentBilling = { configured: boolean; hasCustomer: boolean; autoChargeEnabled: boolean; savedMethod: SavedMethod | null; unpaid: UnpaidLesson[] };
export type PayoutState = { configured: boolean; connected: boolean; payoutsEnabled: boolean };
export type RedirectUrl = { url: string };
/** The platform fee kept from a destination charge. */
export const PLATFORM_FEE_RATE = 0.15;
