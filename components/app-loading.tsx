/** Safe before the requested route and account state have finished resolving. */
export function AppLoading({ fullScreen = false }: { fullScreen?: boolean }) {
  return <div role="status" aria-label="Loading application" aria-busy="true" className={`grid w-full place-items-center bg-background p-6 ${fullScreen ? "min-h-dvh" : "min-h-48"}`}>
    <span aria-hidden="true" className="size-6 rounded-full border-2 border-muted motion-safe:animate-spin" style={{ borderTopColor: "var(--brand-navy, #0a2d53)" }} />
    <span className="sr-only">Loading…</span>
  </div>;
}
