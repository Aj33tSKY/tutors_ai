"use client";

import Link from "next/link";
import { useActionState } from "react";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction, type AuthFormState } from "../actions";

const initialState: AuthFormState = {};

export default function SignInPage() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.75, ease: [0.19, 1, 0.22, 1] }}
      className="w-full max-w-md"
    >
      <h1 className="display-lg">Welcome back</h1>
      <p className="mt-5 text-muted-foreground">Sign in to your Kindling account.</p>

      <form action={formAction} className="mt-10 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required placeholder="you@example.com" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" required />
        </div>

        {state.error && (
          <p role="alert" className="border border-destructive/40 px-4 py-3 text-sm text-destructive">
            {state.error}
          </p>
        )}

        <Button type="submit" disabled={pending} className="w-full" size="lg" aria-busy={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Sign in
        </Button>
      </form>

      <p className="mt-8 text-sm text-muted-foreground">
        New to Kindling?{" "}
        <Link href="/sign-up" className="link-draw text-saffron">
          Create an account
        </Link>
      </p>
    </motion.div>
  );
}
