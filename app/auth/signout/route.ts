import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Redirect even if the integration was removed after the session began.
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
