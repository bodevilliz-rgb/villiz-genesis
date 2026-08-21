"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser-client";
import { parseInviteSessionHash } from "@/lib/invite-session";
import { routes } from "@/lib/routes";

export default function AcceptStaffInvitationPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Securing your Genesis access…");

  useEffect(() => {
    const session = parseInviteSessionHash(window.location.hash);
    // Remove credentials from the visible address and browser history before
    // any asynchronous work. They are never logged or sent to a server action.
    window.history.replaceState(null, "", window.location.pathname);

    if (!session) {
      router.replace("/auth/error?reason=missing_code");
      return;
    }

    const supabase = createBrowserSupabaseClient();
    void supabase.auth
      .setSession({ access_token: session.accessToken, refresh_token: session.refreshToken })
      .then(({ error }) => {
        if (error) {
          router.replace("/auth/error?reason=expired");
          return;
        }
        setMessage("Access confirmed. Opening Genesis…");
        router.replace(routes.dashboard);
        router.refresh();
      });
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-subtle-foreground">Staff invitation</p>
      <h1 className="text-xl font-semibold tracking-tight">Welcome to Genesis</h1>
      <p className="text-[13px] text-muted-foreground">{message}</p>
    </main>
  );
}
