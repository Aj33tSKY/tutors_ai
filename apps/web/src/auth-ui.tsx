import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Check, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { Wordmark } from "../../../src/components/marketing/wordmark.js";
import { Input } from "../../../src/components/ui/input.js";
import { api } from "./api.js";

/** The sign-in family of pages: a calm form on the left, the product story on the right (large screens only). */
export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="grid min-h-screen bg-background text-foreground lg:grid-cols-2">
    <div className="flex flex-col px-6 py-6 sm:px-10">
      <header><Link to="/" aria-label="Hybrid Tutors home" className="inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><Wordmark/></Link></header>
      <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2rem]">{title}</h1>
        {subtitle && <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted-foreground">{subtitle}</p>}
        <div className="mt-8 space-y-5">{children}</div>
        {footer && <p className="mt-8 text-center text-sm text-muted-foreground">{footer}</p>}
      </main>
    </div>
    <BrandPanel/>
  </div>;
}

const wave = (seed: number, amplitude: number) => {
  const points: string[] = [];
  for (let x = 0; x <= 320; x += 4) {
    const envelope = Math.sin((x / 320) * Math.PI);
    const y = 32 + envelope * amplitude * (Math.sin(x * 0.19 + seed) * 0.6 + Math.sin(x * 0.07 + seed * 2) * 0.4);
    points.push(`${x},${y.toFixed(1)}`);
  }
  return points.join(" ");
};

function BrandPanel() {
  return <aside aria-hidden="true" className="relative hidden overflow-hidden border-l bg-card lg:flex lg:items-center lg:justify-center">
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_25%_15%,color-mix(in_oklab,var(--primary)_20%,transparent),transparent_70%),radial-gradient(60%_50%_at_90%_95%,color-mix(in_oklab,var(--violet)_14%,transparent),transparent_70%)]"/>
    <div className="relative w-full max-w-[460px] px-10">
      <p className="text-[0.8125rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">One-to-one A-Level tutoring</p>
      <p className="mt-4 text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.03em]">A little <span className="text-primary">more</span> from every lesson.</p>
      <p className="mt-4 max-w-[26rem] text-[0.9375rem] leading-relaxed text-muted-foreground">Learn with a specialist tutor, then come back to their explanations, your breakthroughs, and what to practise next.</p>
      <div className="mt-8 rounded-2xl border bg-background/70 p-5 shadow-[0_24px_60px_-28px_rgb(0_0_0/0.45)] backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-primary/20 text-sm font-semibold text-foreground">MJ</span>
          <div className="leading-tight"><p className="text-sm font-medium">Mr. Johnson</p><p className="text-xs text-muted-foreground">A-Level Physics · lesson notes</p></div>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-primary"/>Summarised</span>
        </div>
        <svg viewBox="0 0 320 64" className="mt-4 h-14 w-full" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={wave(1, 26)} stroke="var(--primary)" strokeWidth="1.5" opacity="0.9"/>
          <polyline points={wave(2.4, 18)} stroke="var(--primary)" strokeWidth="1" opacity="0.4"/>
        </svg>
        <p className="mt-3 text-[0.9375rem] leading-snug">“The magnetic force changes direction, not the particle’s speed.”</p>
        <p className="mt-2 text-xs text-muted-foreground">Saved to your lesson memory · 12:41</p>
      </div>
      <ul className="mt-8 space-y-3 text-sm">
        {["Only approved tutors appear in search", "Lessons are recorded with consent, then summarised", "A revision assistant grounded in your own lessons"].map((line) =>
          <li key={line} className="flex items-start gap-2.5"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><Check className="size-3.5" strokeWidth={3}/></span><span>{line}</span></li>)}
      </ul>
    </div>
  </aside>;
}

/** Google's standard four-colour "G" (their published artwork; it must not be recoloured or resized relative to the button). */
function GoogleG() {
  return <svg viewBox="0 0 48 48" className="size-5 shrink-0" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>;
}

/**
 * "Sign in with Google", following Google's branding guidelines: the standard-colour G, a light or dark theme (never a coloured
 * fill), their button text wording, and at least the prominence of any other sign-in option. The PKCE cookie is set by the API
 * response, then the browser goes to Google and returns to /auth/confirm?oauth=1.
 */
export function GoogleButton({ label }: { label: "Continue with Google" | "Sign up with Google" | "Sign in with Google" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-2">
    <button type="button" disabled={pending}
      style={{ fontFamily: "'Google Sans', Roboto, 'Helvetica Neue', Arial, sans-serif" }}
      className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-[#747775] bg-white px-3 text-sm font-medium tracking-[0.01em] text-[#1F1F1F] transition-colors outline-none hover:bg-[#F6F6F6] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-70 dark:border-[#8E918F] dark:bg-[#131314] dark:text-[#E3E3E3] dark:hover:bg-[#1E1F20]"
      onClick={async () => {
        setPending(true); setError("");
        try { window.location.assign((await api.googleSignIn()).url); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Google sign-in is not available right now"); setPending(false); }
      }}>
      {pending ? <Loader2 className="size-5 animate-spin" aria-hidden="true"/> : <GoogleG/>}
      <span>{pending ? "Opening Google…" : label}</span>
    </button>
    {error && <Alert tone="error">{error}</Alert>}
  </div>;
}

/** Google sign-in can create an account, so both pages carry the agreement line. */
export function LegalNote() {
  const link = "underline underline-offset-4 hover:text-foreground";
  return <p className="text-center text-xs leading-relaxed text-muted-foreground">By continuing, you agree to the Hybrid Tutors <Link to="/terms" target="_blank" rel="noopener" className={link}>Terms of service</Link> and acknowledge our <Link to="/privacy" target="_blank" rel="noopener" className={link}>Privacy policy</Link>.</p>;
}

export function Divider({ children = "or" }: { children?: ReactNode }) {
  return <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground" role="separator"><span className="h-px flex-1 bg-border"/>{children}<span className="h-px flex-1 bg-border"/></div>;
}

export function Alert({ tone, children }: { tone: "error" | "success"; children: ReactNode }) {
  const Icon = tone === "error" ? AlertCircle : CheckCircle2;
  return <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm leading-snug ${tone === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-foreground"}`}>
    <Icon className={`mt-px size-4 shrink-0 ${tone === "success" ? "text-primary" : ""}`} aria-hidden="true"/><span>{children}</span>
  </div>;
}

const inputClass = "h-11 rounded-lg px-3 text-[0.9375rem] shadow-none placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25";

export function Field({ label, hint, action, ...props }: { label: string; hint?: string; action?: ReactNode } & ComponentProps<"input">) {
  const id = useId();
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3"><label htmlFor={id} className="text-sm font-medium">{label}</label>{action}</div>
    <Input id={id} aria-describedby={hint ? `${id}-hint` : undefined} className={inputClass} {...props}/>
    {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}

export function PasswordField({ label = "Password", hint, action, ...props }: { label?: string; hint?: string; action?: ReactNode } & Omit<ComponentProps<"input">, "type">) {
  const id = useId();
  const [shown, setShown] = useState(false);
  return <div className="space-y-1.5">
    <div className="flex items-baseline justify-between gap-3"><label htmlFor={id} className="text-sm font-medium">{label}</label>{action}</div>
    <div className="relative">
      <Input id={id} type={shown ? "text" : "password"} aria-describedby={hint ? `${id}-hint` : undefined} className={`${inputClass} pr-11`} {...props}/>
      <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}
        className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/25">
        {shown ? <EyeOff className="size-4" aria-hidden="true"/> : <Eye className="size-4" aria-hidden="true"/>}
      </button>
    </div>
    {hint && <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
  </div>;
}

/** Student or tutor, as two large targets rather than a dropdown. Radios keep it a normal form field. */
export function RoleChoice() {
  const options = [{ value: "student", title: "Student", note: "Learn with a tutor" }, { value: "tutor", title: "Tutor", note: "Teach on Hybrid Tutors" }];
  return <fieldset className="space-y-1.5">
    <legend className="text-sm font-medium">I am a</legend>
    <div className="grid grid-cols-2 gap-3">
      {options.map((option, index) => <label key={option.value} className="cursor-pointer">
        <input type="radio" name="role" value={option.value} defaultChecked={index === 0} className="peer sr-only"/>
        <span className="block rounded-lg border bg-background p-3 transition-colors hover:border-foreground/40 peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:ring-[3px] peer-checked:ring-primary/25 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
          <span className="block text-sm font-medium">{option.title}</span><span className="block text-xs text-muted-foreground">{option.note}</span>
        </span>
      </label>)}
    </div>
  </fieldset>;
}
