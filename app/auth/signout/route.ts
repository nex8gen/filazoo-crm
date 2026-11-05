import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { workspaceCookie } from "@/lib/workspaces";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) await supabase.auth.signOut();
  } catch {
    // Redirect even if the integration was removed after the session began.
  }
  revalidatePath("/", "layout");
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete(workspaceCookie);
  return response;
}
