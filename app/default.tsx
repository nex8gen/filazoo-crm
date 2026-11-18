import { notFound } from "next/navigation";

// The company drawer is a parallel slot. Next requires an explicit fallback
// for the implicit children slot too; preserve 404s for unmatched page URLs.
export default function Default() {
  notFound();
}
