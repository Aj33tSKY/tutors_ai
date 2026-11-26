import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api.js";

// Starts Google sign-in: the API sets the PKCE cookie, then the browser goes to Google and returns to /auth/confirm?oauth=1.
export function GoogleButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-2"><button type="button" className="w-full rounded border p-2" disabled={pending} onClick={async () => {
    setPending(true); setError("");
    try { window.location.assign((await api.googleSignIn()).url); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Google sign-in is not available right now"); setPending(false); }
  }}>{pending ? "Opening Google…" : label}</button>{error && <p role="alert">{error}</p>}<p className="text-center text-sm">or use your email</p></div>;
}

export function AccountForm({ mode }: { mode: "signup" | "reset" | "password" }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Choose a new password";
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="display-md">{title}</h1>{mode === "signup" && <GoogleButton label="Sign up with Google"/>}<form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "signup") setMessage((await api.signUp(String(form.get("email")), String(form.get("password")), String(form.get("name")), String(form.get("role")))).message);
      if (mode === "reset") setMessage((await api.resetPassword(String(form.get("email")))).message);
      if (mode === "password") { await api.updatePassword(String(form.get("password"))); navigate("/dashboard", { replace: true }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again"); } finally { setPending(false); }
  }}>
    {mode === "signup" && <><label className="block">Full name<input name="name" autoComplete="name" className="block w-full rounded border p-2" required maxLength={150}/></label><label className="block">I am a<select name="role" className="block w-full rounded border p-2"><option value="student">Student</option><option value="tutor">Tutor</option></select></label></>}
    {mode !== "password" && <label className="block">Email<input name="email" type="email" autoComplete="email" className="block w-full rounded border p-2" required/></label>}
    {mode !== "reset" && <label className="block">Password<input name="password" type="password" autoComplete="new-password" className="block w-full rounded border p-2" minLength={8} maxLength={256} required/></label>}
    <button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={pending}>{pending ? "Please wait…" : title}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form><Link to="/sign-in">Back to sign in</Link></main>;
}

// First sign-in with Google: the account type is chosen once here, because Google cannot carry it.
export function ChooseRole() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const choose = async (role: "student" | "tutor") => {
    setPending(true); setError("");
    try { await api.chooseRole(role); window.location.assign(role === "tutor" ? "/dashboard/tutor/availability" : "/dashboard"); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again"); setPending(false); }
  };
  return <main className="mx-auto max-w-md space-y-4 p-8"><h1 className="display-md">How will you use Kindling?</h1><p>You can&apos;t change this later.</p>
    <button className="w-full rounded bg-primary px-4 py-2 text-primary-foreground" disabled={pending} onClick={() => void choose("student")}>I&apos;m a student</button>
    <button className="w-full rounded border px-4 py-2" disabled={pending} onClick={() => void choose("tutor")}>I&apos;m a tutor</button>{error && <p role="alert">{error}</p>}</main>;
}

export function AuthConfirm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const complete = async () => {
    setPending(true);
    try { await api.exchange(params.get("code")!); navigate(params.get("recovery") === "1" ? "/reset-password" : "/dashboard", { replace: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm this link"); setPending(false); }
  };
  // Email links need a deliberate click (prefetchers and StrictMode would consume the one-time code). A Google return is a
  // real navigation in the browser that started it, so it completes by itself, once.
  const started = useRef(false);
  useEffect(() => { if (params.get("oauth") === "1" && params.get("code") && !started.current) { started.current = true; void complete(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <main className="mx-auto max-w-md space-y-4 p-8"><h1 className="display-md">Confirm your account</h1><button disabled={pending || !params.get("code")} className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={complete}>{pending ? "Confirming…" : "Continue"}</button>{(!params.get("code") || error) && <p role="alert">{error || "This link is missing a confirmation code. Request a new link."}</p>}</main>;
}
