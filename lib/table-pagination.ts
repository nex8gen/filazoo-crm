export function tablePaginationState(page: number, pageCount: number, total: number, start?: number, end?: number) {
  const totalItems = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const pages = totalItems ? Math.max(1, Number.isFinite(pageCount) ? Math.trunc(pageCount) : 1) : 1;
  const currentPage = Math.min(pages, Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1));
  const hasRange = Number.isFinite(start) && Number.isFinite(end);
  const first = totalItems && hasRange ? Math.min(totalItems, Math.max(1, Math.trunc(start!))) : 0;
  const last = totalItems && hasRange ? Math.min(totalItems, Math.max(first, Math.trunc(end!))) : 0;
  return { page: currentPage, pages, total: totalItems, start: first, end: last, hasRange, canPrevious: totalItems > 0 && currentPage > 1, canNext: totalItems > 0 && currentPage < pages };
}
