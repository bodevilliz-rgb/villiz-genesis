import Link from "next/link";
import { routes } from "@/lib/routes";

const REASONS: Record<string, string> = {
  expired: "That sign-in link has expired or has already been used. Links are valid for one hour and work once.",
  missing_code: "That link is incomplete. Open the most recent email and use the button inside it.",
};

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-subtle-foreground">Sign-in</p>
      <h1 className="text-xl font-semibold tracking-tight">That link did not work</h1>
      <p className="max-w-sm text-[13px] text-muted-foreground">
        {REASONS[reason ?? ""] ?? "Something interrupted the sign-in. Request a new link and try again."}
      </p>
      <Link
        href={routes.login}
        className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        Request a new link
      </Link>
    </main>
  );
}
