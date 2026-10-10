import Link from "next/link";

export const metadata = { title: "Access denied" };

export default function AccessDeniedPage() {
  return (
    <section className="section-card access-denied-card">
      <div className="section-body">
        <p className="eyebrow">WORKSPACE ACCESS</p>
        <h1>Your account is not a Filazoo workspace member</h1>
        <p>An administrator must add your Supabase user ID to the workspace_members table before CRM data can be opened.</p>
        <Link className="button button-outline" href="/auth/signout">Sign out</Link>
      </div>
    </section>
  );
}
