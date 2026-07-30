import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * The sign-in screen states plainly what this platform is and who it is for.
 * A client who lands here should understand immediately that there is no
 * account for them to open — that is a product decision, not an oversight.
 */
export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className="size-2.5 rounded-full bg-primary" />
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-subtle-foreground">
              Villiz · Project Genesis
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Villiz Social Manager</h1>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            The operating system behind every client account we run. Internal access only — we sign in, clients
            never do.
          </p>
        </div>

        <LoginForm />

        <p className="mt-8 text-[12px] leading-relaxed text-subtle-foreground">
          Access is granted by a platform administrator. If your address is not recognised, ask your account lead
          to invite you.
        </p>
      </div>
    </main>
  );
}
