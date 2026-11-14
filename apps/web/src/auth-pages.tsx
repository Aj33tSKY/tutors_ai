import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api.js";

export function AccountForm({ mode }: { mode: "signup" | "reset" | "password" }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const title = mode === "signup" ? "Create your account" : mode === "reset" ? "Reset your password" : "Choose a new password";
  return <main className="mx-auto max-w-md space-y-5 p-8"><h1 className="display-md">{title}</h1><form className="space-y-4" onSubmit={async (event) => {
    event.preventDefault(); setPending(true); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "signup") setMessage((await api.signUp(String(form.get("email")), String(form.get("password")), String(form.get("name")), String(form.get("role")))).message);
      if (mode === "reset") setMessage((await api.resetPassword(String(form.get("email")))).message);
      if (mode === "password") { await api.updatePassword(String(form.get("password"))); navigate("/dashboard", { replace: true }); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Please try again"); } finally { setPending(false); }
  }}>
    {mode === "signup" && <><label className="block">Full name<input name="name" autoComplete="name" className="block w-full rounded border p-2" required maxLength={150}/></label><label className="block">I am a<select name="role" className="block w-full rounded border p-2"><option value="student">Student</option><option value="parent">Parent</option><option value="tutor">Tutor</option></select></label></>}
    {mode !== "password" && <label className="block">Email<input name="email" type="email" autoComplete="email" className="block w-full rounded border p-2" required/></label>}
    {mode !== "reset" && <label className="block">Password<input name="password" type="password" autoComplete="new-password" className="block w-full rounded border p-2" minLength={8} maxLength={256} required/></label>}
    <button className="rounded bg-primary px-4 py-2 text-primary-foreground" disabled={pending}>{pending ? "Please wait…" : title}</button>
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </form><Link to="/sign-in">Back to sign in</Link></main>;
}

export function AuthConfirm() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // A deliberate click avoids prefetch/StrictMode consuming a one-time code.
  return <main className="mx-auto max-w-md space-y-4 p-8"><h1 className="display-md">Confirm your account</h1><button disabled={pending || !params.get("code")} className="rounded bg-primary px-4 py-2 text-primary-foreground" onClick={async () => {
    setPending(true);
    try { await api.exchange(params.get("code")!); navigate(params.get("recovery") === "1" ? "/reset-password" : "/dashboard", { replace: true }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm this link"); setPending(false); }
  }}>{pending ? "Confirming…" : "Continue"}</button>{(!params.get("code") || error) && <p role="alert">{error || "This link is missing a confirmation code. Request a new link."}</p>}</main>;
}
