import {
  ArrowRight,
  CheckCircle2,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";

import { api, setToken } from "../lib/api";
import ThemeToggle from "./ThemeToggle";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("admin@northstar.demo");
  const [password, setPassword] = useState("AdminDemo123!");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ access_token: string }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      setToken(result.access_token);
      onLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh bg-[#f7f7f5] transition-colors lg:grid-cols-[1.08fr_.92fr] dark:bg-slate-950">
      <section className="relative hidden min-h-dvh overflow-hidden bg-[#14231c] px-[clamp(3rem,7vw,7.5rem)] py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="pointer-events-none absolute -right-40 -bottom-44 size-[620px] rounded-full border border-white/5 shadow-[0_0_0_80px_rgb(255_255_255_/_0.025),0_0_0_160px_rgb(255_255_255_/_0.018)]" />
        <a
          href="/"
          aria-label="OrbitDesk home"
          className="relative z-10 flex items-center gap-2.5 text-lg font-bold tracking-tight text-white no-underline"
        >
          <span className="grid size-9 place-items-center rounded-xl bg-lime-300 text-emerald-950">
            <Layers3 size={19} />
          </span>
          OrbitDesk
        </a>

        <div className="relative z-10 max-w-2xl">
          <p className="mb-5 text-[11px] font-bold tracking-[0.2em] text-lime-300 uppercase">
            Work in motion
          </p>
          <h1 className="max-w-xl text-5xl leading-[1.03] font-bold tracking-[-0.055em] sm:text-6xl xl:text-7xl">
            Clarity for the work that matters.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-emerald-50/70">
            A calm, secure workspace where product teams plan together, move quickly, and never lose
            the thread.
          </p>
          <div className="mt-10 flex flex-wrap gap-x-7 gap-y-3 text-xs font-medium text-emerald-50/80">
            <span className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-lime-300" />
              Tenant safe
            </span>
            <span className="flex items-center gap-2">
              <MessageCircleMore size={17} className="text-lime-300" />
              Real-time collaboration
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={17} className="text-lime-300" />
              Workflow ready
            </span>
          </div>
        </div>

        <p className="relative z-10 m-0 text-xs text-emerald-50/45">
          Built for focused product teams.
        </p>
      </section>

      <section className="relative flex min-h-dvh items-center justify-center px-5 py-10 sm:px-10">
        <ThemeToggle className="absolute top-5 right-5" />
        <div className="w-full max-w-md">
          <div className="mb-12 flex items-center gap-2.5 text-lg font-bold text-slate-900 lg:hidden dark:text-white">
            <span className="grid size-9 place-items-center rounded-xl bg-lime-300 text-emerald-950">
              <Layers3 size={18} />
            </span>
            OrbitDesk
          </div>

          <p className="mb-2 text-[11px] font-bold tracking-[0.17em] text-emerald-700 uppercase">
            Welcome back
          </p>
          <h2 className="m-0 text-3xl font-bold tracking-[-0.035em] text-slate-950 dark:text-white">
            Sign in to your workspace
          </h2>
          <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
            Your permissions and workspace are assigned securely after authentication.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus
                className="mt-2 block h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 shadow-sm transition outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600 dark:focus:border-emerald-500 dark:focus:ring-emerald-950"
              />
            </label>
            <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Password
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                minLength={8}
                required
                className="mt-2 block h-12 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm font-normal text-slate-900 shadow-sm transition outline-none placeholder:text-slate-400 hover:border-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-600 dark:focus:border-emerald-500 dark:focus:ring-emerald-950"
              />
            </label>

            {error && (
              <p
                role="alert"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
            >
              {busy ? (
                <>
                  <LoaderCircle size={17} className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight size={17} />
                </>
              )}
            </button>
          </form>

          <div className="mt-7 rounded-xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <LockKeyhole size={15} />
              </span>
              <div>
                <p className="m-0 text-xs font-semibold text-slate-700 dark:text-slate-200">
                  Portfolio demo access
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                  The form is prefilled with the organization admin account. Roles are never
                  selected in the UI—they come from the authenticated backend session.
                </p>
              </div>
            </div>
          </div>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
            <ShieldCheck size={14} />
            Demo data resets with each portfolio session.
          </p>
        </div>
      </section>
    </main>
  );
}
