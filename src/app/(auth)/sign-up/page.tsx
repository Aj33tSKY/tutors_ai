"use client";

import Link from "next/link";
import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { GraduationCap, Users, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { signUpAction, type AuthFormState } from "../actions";
import type { UserRole } from "@/lib/types";

const ROLES: { value: UserRole; label: string; desc: string; icon: typeof GraduationCap }[] = [
  { value: "student", label: "Student", desc: "Book tutors & revise", icon: GraduationCap },
  { value: "parent", label: "Parent", desc: "Track your child's progress", icon: Users },
  { value: "tutor", label: "Tutor", desc: "Teach & get paid", icon: BookOpen },
];

const initialState: AuthFormState = {};

export default function SignUpPage() {
  return (
    <Suspense>
      <SignUpForm />
    </Suspense>
  );
}

function SignUpForm() {
  const params = useSearchParams();
  const [role, setRole] = useState<UserRole>((params.get("role") as UserRole) || "student");
  const [state, formAction, pending] = useActionState(signUpAction, initialState);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.75, ease: [0.19, 1, 0.22, 1] }}
      className="w-full max-w-md"
    >
      <h1 className="display-lg">Join Kindling</h1>
      <p className="mt-5 text-muted-foreground">
        Sign up as a student, parent or tutor — it takes under a minute.
      </p>

      <div role="radiogroup" aria-label="Account type" className="mt-10 grid grid-cols-3 gap-3">
        {ROLES.map((r) => (
          <button
            key={r.value}
            type="button"
            role="radio"
            aria-checked={role === r.value}
            onClick={() => setRole(r.value)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors duration-200",
              role === r.value
                ? "border-saffron bg-saffron/10 text-saffron"
                : "border-border bg-card text-muted-foreground hover:border-foreground/20 hover:bg-secondary/50 hover:text-foreground",
            )}
          >
            <r.icon className="size-5" />
            <span className="text-sm font-medium">{r.label}</span>
          </button>
        ))}
      </div>
      <p className="eyebrow mt-4">
        {ROLES.find((r) => r.value === role)?.desc}
      </p>

      <form action={formAction} className="mt-10 space-y-5">
        <input type="hidden" name="role" value={role} />
        <div className="space-y-1.5">
          <Label htmlFor="full_name">Full name</Label>
          <Input id="full_name" name="full_name" required placeholder="Jane Smith" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required minLength={8} />
        </div>

        {state.error && (
          <p role="alert" className="border border-destructive/40 px-4 py-3 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="w-full" size="lg" aria-busy={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Create account
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="link-draw text-saffron">
          Sign in
        </Link>
      </p>
    </motion.div>
  );
}
