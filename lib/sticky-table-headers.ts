type TrackedTable = {
  table: HTMLTableElement;
  header: HTMLTableSectionElement;
  clips: HTMLElement[];
  offset: number;
};

/** Pin the actual header, retaining its controls, semantics and column sizing.
 * Horizontal overflow traps position:sticky. A browser scroll timeline keeps
 * those headers on the compositor, without a JS update after each scroll frame.
 */
export function stickyTableHeaders(root: HTMLElement) {
  let tables: TrackedTable[] = [];
  let frame = 0;
  let refresh = true;
  let disposed = false;
  const nativeTimeline = CSS.supports("animation-timeline", "--crm-table-scroll")
    && CSS.supports("animation-range", "1px 2px");
  const owners = new Set<HTMLElement>();
  const observed = new Set<Element>();

  const reset = ({ header }: TrackedTable) => {
    for (const property of ["--crm-table-header-offset", "--crm-table-pin-start", "--crm-table-pin-end", "--crm-table-pin-distance"])
      header.style.removeProperty(property);
    delete header.dataset.crmStickyHeader;
  };

  const resize = new ResizeObserver(() => {
    refresh = true;
    schedule();
  });

  function collect() {
    const previous = new Map(tables.map(entry => [entry.header, entry]));
    const nextObserved = new Set<Element>([root]);
    const nextOwners = new Set<HTMLElement>();
    tables = Array.from(root.querySelectorAll<HTMLTableElement>("table.crm-table, table[data-sticky-table]"))
      .flatMap(table => {
        const header = table.tHead;
        if (!header) return [];
        const clips: HTMLElement[] = [];
        for (let parent = table.parentElement; parent; parent = parent.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) clips.push(parent);
        }
        const entry = previous.get(header) ?? { table, header, clips, offset: 0 };
        entry.clips = clips;
        previous.delete(header);
        nextObserved.add(table);
        nextObserved.add(header);
        clips.forEach(clip => nextObserved.add(clip));

        if (nativeTimeline && table.getClientRects().length) {
          const owner = clips.find(clip => clip.scrollHeight > clip.clientHeight + 1)
            ?? document.scrollingElement as HTMLElement;
          const ownerTop = owner === document.scrollingElement ? 0 : owner.getBoundingClientRect().top + owner.clientTop;
          const heading = header.getBoundingClientRect();
          const transform = getComputedStyle(header).transform;
          const offset = transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
          const origin = heading.top - offset;
          const gap = parseFloat(getComputedStyle(header).getPropertyValue("--crm-table-sticky-top")) || 32;
          const start = origin - ownerTop + owner.scrollTop - gap;
          const distance = Math.max(0, table.getBoundingClientRect().bottom - heading.height - origin);
          header.style.setProperty("--crm-table-pin-start", `${start}px`);
          header.style.setProperty("--crm-table-pin-end", `${start + Math.max(1, distance)}px`);
          header.style.setProperty("--crm-table-pin-distance", `${distance}px`);
          header.dataset.crmStickyHeader = "native";
          owner.dataset.crmTableScroll = "";
          nextOwners.add(owner);
        }
        return [entry];
      });
    previous.forEach(reset);
    owners.forEach(owner => { if (!nextOwners.has(owner)) delete owner.dataset.crmTableScroll; });
    owners.clear();
    nextOwners.forEach(owner => owners.add(owner));
    observed.forEach(element => { if (!nextObserved.has(element)) resize.unobserve(element); });
    nextObserved.forEach(element => { if (!observed.has(element)) resize.observe(element); });
    observed.clear();
    nextObserved.forEach(element => observed.add(element));
  }

  function update() {
    frame = 0;
    if (disposed) return;
    if (refresh) {
      collect();
      refresh = false;
    }
    if (nativeTimeline) return;
    // Compatibility fallback for browsers without scroll timelines.
    const offsets = tables.map(({ table, header, clips, offset }) => {
      if (!table.getClientRects().length) return 0;
      const bounds = table.getBoundingClientRect();
      const heading = header.getBoundingClientRect();
      const origin = heading.top - offset;
      const gap = parseFloat(getComputedStyle(header).getPropertyValue("--crm-table-sticky-top")) || 32;
      const top = clips.filter(clip => clip.scrollHeight > clip.clientHeight + 1)
        .reduce((edge, clip) => Math.max(edge, clip.getBoundingClientRect().top + clip.clientTop), 0) + gap;
      return Math.max(0, Math.min(top - origin, bounds.bottom - heading.height - origin));
    });
    tables.forEach((entry, index) => {
      const offset = offsets[index];
      if (entry.header.dataset.crmStickyHeader === undefined || entry.offset !== offset) {
        entry.header.style.setProperty("--crm-table-header-offset", `${offset}px`);
        entry.header.dataset.crmStickyHeader = offset > 0 ? "stuck" : "ready";
        entry.offset = offset;
      }
    });
  }

  function schedule() {
    if (!disposed && !frame) frame = requestAnimationFrame(update);
  }

  const mutation = new MutationObserver(() => {
    refresh = true;
    schedule();
  });
  mutation.observe(root, { childList: true, subtree: true });
  // Scroll listeners are needed only by the compatibility fallback.
  if (!nativeTimeline) window.addEventListener("scroll", schedule, { capture: true, passive: true });
  const onResize = () => { refresh = true; schedule(); };
  window.addEventListener("resize", onResize, { passive: true });
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    mutation.disconnect();
    resize.disconnect();
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", onResize);
    tables.forEach(reset);
    owners.forEach(owner => { delete owner.dataset.crmTableScroll; });
  };
}
