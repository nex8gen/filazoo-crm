import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims) await supabase.auth.signOut();
  } catch {
    // Redirect even if the integration was removed after the session began.
  }
  revalidatePath("/", "layout");
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
