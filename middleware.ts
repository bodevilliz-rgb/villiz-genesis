import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/infrastructure/supabase/middleware-client";

const PUBLIC_PATHS = ["/login", "/auth/callback", "/auth/error"];

/**
 * Session refresh + route guard.
 *
 * The guard here is a redirect for user experience, not a security boundary.
 * The real boundary is Row Level Security in Postgres: a request that somehow
 * reached a page without a session would still read zero rows.
 */
export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  const { pathname } = request.nextUrl;
  const isPublic = pathname === "/" || PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve intent so the employee lands where they were headed.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
