import { notFound } from "next/navigation";

// Profile drawers use parallel slots. Next requires an explicit fallback
// for the implicit children slot too; preserve 404s for unmatched page URLs.
export default function Default() {
  notFound();
}
