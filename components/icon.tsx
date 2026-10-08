export type IconName = "grid"|"building"|"pipeline"|"mail"|"catalog"|"automation"|"setup"|"settings"|"search"|"filter"|"menu"|"arrow";
export function Icon({ name, size=19 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    building:<><path d="M4 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16M9 21v-4h3v4M8 7h1m3 0h1M8 11h1m3 0h1M17 9h2a1 1 0 0 1 1 1v11M2 21h20"/></>,
    pipeline:<><path d="M4 5h16M7 12h10M10 19h4"/><circle cx="4" cy="5" r="1"/><circle cx="7" cy="12" r="1"/><circle cx="10" cy="19" r="1"/></>,
    mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    catalog:<><path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Z"/><path d="M5 17a2 2 0 0 1 2-2h12M9 8h6"/></>,
    automation:<><path d="M8 3h8l1 3 3 1v8l-3 1-1 3H8l-1-3-3-1V7l3-1 1-3Z"/><circle cx="12" cy="11" r="3"/><path d="M9 22h6"/></>,
    setup:<><path d="M9 4h6M9 20h6M4 9v6M20 9v6"/><rect x="6" y="6" width="12" height="12" rx="3"/><path d="m9 12 2 2 4-4"/></>,
    settings:<><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM12 2v3m0 14v3M2 12h3m14 0h3"/></>,
    search:<><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, filter:<path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z"/>, menu:<path d="M4 7h16M4 12h16M4 17h16"/>, arrow:<path d="m9 18 6-6-6-6"/>,
  };
  return <svg aria-hidden viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
