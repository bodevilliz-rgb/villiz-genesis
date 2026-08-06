"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createGenesisClient } from "@/infrastructure/supabase/server-client";
import { isAllowedEmail, serverEnv, allowedEmailDomains } from "@/lib/env";
import { routes } from "@/lib/routes";
import { errorState, successState, type ActionState } from "../action-result";

const emailSchema = z.string().trim().email();

/**
 * Passwordless sign-in.
 *
 * Decision: magic links, not passwords. Project Genesis has a small, known set
 * of employees; removing stored passwords removes credential stuffing, reset
 * flows and password policy from the platform entirely.
 *
 * `shouldCreateUser: false` means an unknown address cannot self-provision.
 * Staff are invited by a platform administrator, so a client who somehow
 * obtains the URL still has no route in.
 */
export async function requestSignInLink(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const parsed = emailSchema.safeParse(formData.get("email"));
    if (!parsed.success) {
      return { status: "error", message: "Enter a valid email address.", fieldErrors: { email: ["Enter a valid email address."] } };
    }

    const email = parsed.data.toLowerCase();

    if (!isAllowedEmail(email)) {
      return {
        status: "error",
        message: `Project Genesis is for Villiz staff only. Use your ${allowedEmailDomains()[0] ?? "company"} address.`,
        fieldErrors: { email: ["This address is not permitted."] },
      };
    }

    const supabase = await createGenesisClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${serverEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}${routes.authCallback}`,
      },
    });

    if (error) {
      // Deliberately identical to the success path: revealing which addresses
      // exist would leak the staff list to anyone who finds the login page.
      console.warn("[genesis] sign-in link not sent", error.message);
    }

    return successState("Check your inbox. The link is valid for one hour.");
  } catch (error) {
    return errorState(error);
  }
}

export async function signOut(): Promise<void> {
  const supabase = await createGenesisClient();
  await supabase.auth.signOut();
  redirect(routes.login);
}
