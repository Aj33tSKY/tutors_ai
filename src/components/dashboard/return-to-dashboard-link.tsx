"use client";

import { useAppNavigation } from "@/components/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ReturnToDashboardLink() {
  const router = useAppNavigation();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="-ml-2"
      onClick={() => {
        router.navigate("/dashboard");
        window.setTimeout(() => router.refresh(), 0);
      }}
    >
      <ArrowLeft className="size-4" /> All sessions
    </Button>
  );
}
