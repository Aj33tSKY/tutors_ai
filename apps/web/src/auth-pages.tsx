import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { GraduationCap, Loader2, UserRound } from "lucide-react";
import { Button } from "../../../src/components/ui/button.js";
import { api } from "./api.js";
import { Alert, AuthShell, Divider, Field, GoogleButton, LegalNote, PasswordField, RoleChoice } from "./auth-ui.js";

export { GoogleButton };

const submitClass = "h-11 w-full text-[0.9375rem] font-semibold";
const linkClass = "font-medium text-foreground underline underline-offset-4 decoration-border hover:decoration-foreground";
const messageOf = (cause: unknown, fallback = "Please try again") => cause instanceof Error ? cause.message : fallback;

export function SignInPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // Only same-site paths are honoured, so a crafted link cannot send a signed-in user elsewhere.
  const next = search.get("next"); const destination = next && /^\/(?![/\\])/.test(next) ? next : "/dashboard";
  return <AuthShell title="Welcome back" subtitle="Sign in to pick up where your last lesson left off."
    footer={<>New to Hybridtutors? <Link to="/sign-up" className={linkClass}>Create an account</Link></>}>
    <GoogleButton label="Continue with Google"/>
    <Divider/>
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setError("");
      const form = new FormData(event.currentTarget);
      try { const result = await api.signIn(String(form.get("email")), String(form.get("password"))); client.clear(); client.setQueryData(["identity"], result); navigate(destination); }
      catch (cause) { setError(messageOf(cause, "Could not sign in")); } finally { setPending(false); }
    }}>
      <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required/>
      <PasswordField name="password" autoComplete="current-password" placeholder="Your password" required
        action={<Link to="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Forgot password?</Link>}/>
      {error && <Alert tone="error">{error}</Alert>}
      <Button className={submitClass} disabled={pending}>{pending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true"/>Signing in…</> : "Sign in"}</Button>
    </form>
    <LegalNote/>
  </AuthShell>;
}

type Mode = "signup" | "reset" | "password";
const copy: Record<Mode, { title: string; subtitle: string; submit: string; pending: string }> = {
  signup: { title: "Create your account", subtitle: "Start learning one-to-one with a specialist A-Level tutor.", submit: "Create account", pending: "Creating account…" },
  reset: { title: "Reset your password", subtitle: "Enter your email and we’ll send you a link to choose a new one.", submit: "Send reset link", pending: "Sending…" },
  password: { title: "Choose a new password", subtitle: "Pick something at least 8 characters long.", submit: "Update password", pending: "Updating…" },
};

export function AccountForm({ mode }: { mode: Mode }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const text = copy[mode];
  const footer = mode === "signup" ? <>Already have an account? <Link to="/sign-in" className={linkClass}>Sign in</Link></> : <Link to="/sign-in" className={linkClass}>Back to sign in</Link>;
  if (message) return <AuthShell title={mode === "signup" ? "Check your email" : "Reset link sent"} footer={footer}>
    <Alert tone="success">{message}{sentTo && <> We sent it to <strong className="font-semibold">{sentTo}</strong>.</>}</Alert>
    <p className="text-sm text-muted-foreground">It can take a minute to arrive. If you don’t see it, check your spam folder.</p>
  </AuthShell>;
  return <AuthShell title={text.title} subtitle={text.subtitle} footer={footer}>
    {mode === "signup" && <><div className="space-y-2"><GoogleButton label="Sign up with Google"/><p className="text-center text-xs text-muted-foreground">With Google you’ll choose student or tutor next.</p></div><Divider/></>}
    <form className="space-y-4" onSubmit={async (event) => {
      event.preventDefault(); setPending(true); setError(""); setMessage("");
      const form = new FormData(event.currentTarget);
      try {
        if (mode === "signup") { const email = String(form.get("email")); setSentTo(email); setMessage((await api.signUp(email, String(form.get("password")), String(form.get("name")), String(form.get("role")))).message); }
        if (mode === "reset") { setSentTo(String(form.get("email"))); setMessage((await api.resetPassword(String(form.get("email")))).message); }
        if (mode === "password") { await api.updatePassword(String(form.get("password"))); navigate("/dashboard", { replace: true }); }
      } catch (cause) { setError(messageOf(cause)); } finally { setPending(false); }
    }}>
      {mode === "signup" && <><Field label="Full name" name="name" autoComplete="name" placeholder="Alex Morgan" required maxLength={150}/><RoleChoice/></>}
      {mode !== "password" && <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required/>}
      {mode !== "reset" && <PasswordField label={mode === "password" ? "New password" : "Password"} name="password" autoComplete="new-password" minLength={8} maxLength={256} required hint="At least 8 characters"/>}
      {error && <Alert tone="error">{error}</Alert>}
      <Button className={submitClass} disabled={pending}>{pending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true"/>{text.pending}</> : text.submit}</Button>
    </form>
    {mode === "signup" && <LegalNote/>}
  </AuthShell>;
}

// First sign-in with Google: the account type is chosen once here, because Google cannot carry it.
export function ChooseRole() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const choose = async (role: "student" | "tutor") => {
    setPending(true); setError("");
    try { await api.chooseRole(role); window.location.assign(role === "tutor" ? "/dashboard/tutor/availability" : "/dashboard"); }
    catch (cause) { setError(messageOf(cause)); setPending(false); }
  };
  const options = [
    { role: "student" as const, title: "I’m a student", note: "Find a tutor, book lessons and keep notes from every session.", Icon: GraduationCap },
    { role: "tutor" as const, title: "I’m a tutor", note: "Teach on Hybridtutors. Your profile is reviewed before it appears in search.", Icon: UserRound },
  ];
  return <AuthShell title="How will you use Hybridtutors?" subtitle="Pick one to finish setting up your account. This can’t be changed later.">
    <div className="space-y-3">{options.map(({ role, title, note, Icon }) =>
      <button key={role} type="button" disabled={pending} onClick={() => void choose(role)}
        className="flex w-full items-start gap-4 rounded-xl border bg-background p-4 text-left outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-foreground"><Icon className="size-5" aria-hidden="true"/></span>
        <span><span className="block text-base font-semibold">{title}</span><span className="mt-0.5 block text-sm leading-snug text-muted-foreground">{note}</span></span>
      </button>)}</div>
    {error && <Alert tone="error">{error}</Alert>}
  </AuthShell>;
}

export function AuthConfirm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const complete = async () => {
    setPending(true);
    try { await api.exchange(params.get("code")!); navigate(params.get("recovery") === "1" ? "/reset-password" : "/dashboard", { replace: true }); }
    catch (cause) { setError(messageOf(cause, "Could not confirm this link")); setPending(false); }
  };
  // Email links need a deliberate click (prefetchers and StrictMode would consume the one-time code). A Google return is a
  // real navigation in the browser that started it, so it completes by itself, once.
  const automatic = params.get("oauth") === "1" && Boolean(params.get("code"));
  const started = useRef(false);
  useEffect(() => { if (automatic && !started.current) { started.current = true; void complete(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (automatic && !error) return <AuthShell title="Signing you in…"><p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true"/>One moment while we finish setting up your account.</p></AuthShell>;
  return <AuthShell title="Confirm your account" subtitle="One more step and you’re in.">
    <Button className={submitClass} disabled={pending || !params.get("code")} onClick={complete}>{pending ? "Confirming…" : "Continue"}</Button>
    {(!params.get("code") || error) && <Alert tone="error">{error || "This link is missing a confirmation code. Request a new link."}</Alert>}
    <p className="text-center text-sm"><Link to="/sign-in" className={linkClass}>Back to sign in</Link></p>
  </AuthShell>;
}
