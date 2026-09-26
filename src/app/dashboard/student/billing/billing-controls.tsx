"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { setAutoChargeAction } from "./actions";

export function AutoChargeToggle({
  enabled,
  canEnable,
}: {
  enabled: boolean;
  canEnable: boolean;
}) {
  const [state, action, pending] = useActionState(setAutoChargeAction, {});

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="enabled" value={enabled ? "off" : "on"} />
      <Button
        type="submit"
        variant={enabled ? "outline" : "default"}
        disabled={pending || (!enabled && !canEnable)}
      >
        {pending
          ? "Saving…"
          : enabled
            ? "Turn off automatic payment"
            : "Turn on automatic payment"}
      </Button>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {!enabled && !canEnable && (
        <p className="text-sm text-muted-foreground">
          Save a payment method first.
        </p>
      )}
    </form>
  );
}
