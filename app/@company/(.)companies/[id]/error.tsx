"use client";

export default function Error({ retry }: { error: unknown; retry: () => void }) {
  return <div role="alert" className="space-y-4 py-12 text-center text-sm">
    <p>We could not load this company. Please try again.</p>
    <button type="button" onClick={retry} className="rounded-md border px-4 py-2 hover:bg-muted">Try again</button>
  </div>;
}
