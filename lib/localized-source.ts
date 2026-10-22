// React may reuse a DOM node for a different contact, label, or placeholder.
// Only restore its saved source when the current value is our own translation.
export function localizedSource(current: string, source: string | undefined, translation: string | undefined) {
  return translation === undefined || current !== translation ? current : source ?? current;
}
