type Product = { sku: string; name: string; material?: string | null };
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\+/g, " plus ").replace(/[^a-z0-9]+/g, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function oneEditApart(left: string, right: string) {
  if (Math.abs(left.length - right.length) > 1) return false;
  let a = 0, b = 0, edits = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) a++;
    if (right.length >= left.length) b++;
  }
  return edits + (left.length - a) + (right.length - b) === 1;
}

export function allQuotationProductsRequested(messages: readonly { role: string; content: string }[]) {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    if (/\b(?:all|every)\b.{0,70}\b(?:mentioned|requested|asked|in (?:his|her|their|the) email|from (?:his|her|their|the) email)\b/i.test(message.content)) return false;
    if (/\b(?:not|no|never|without|don't|do not)\b.{0,30}\b(?:all|every|entire|full)\b|\bonly\b|不要.*(?:全部|所有)/i.test(message.content)) return false;
    if (/\b(?:all|every|entire|complete|full)\s+(?:(?:the|our|your|current|active|available)\s+)*(?:products?|catalog(?:ue)?|range)\b|(?:全部|所有)(?:的)?产品/i.test(message.content)) return true;
    if (/\b(?:creat|mak|prepar|quot|qut|qat|catal|catel)/i.test(message.content)) return false;
  }
  return false;
}

/** Literal catalogue matching: exact products first, then an unambiguous base
 * material. Never expand PLA to CF/matte/silk or TPU to every hardness silently.
 */
export function matchQuotationProducts(text: string, products: readonly Product[]) {
  // Preserve list/sentence boundaries: "PETG-CF, ABS" must never form the
  // reversed alias "CF ABS", nor "ABS, ASA" become the blend ABS-ASA.
  const source = text.normalize("NFKC").split(/[,;:!?\r\n。；、，]|\.(?!\d)/).map(normalize).join(" | ");
  const materialNames = [...new Set(products.map(product => normalize(product.material ?? "")).filter(value => /^[a-z][a-z0-9]{1,19}$/.test(value)))];
  const families = [...materialNames].sort((a, b) => b.length - a.length).map(escape).join("|") || "(?!)";
  const matches: Array<{ start: number; end: number; sku: string }> = [];
  for (const product of products) {
    const aliases = new Set([normalize(product.sku), normalize(product.name)]);
    // A family request such as "silk PLA" selects its actual base listing,
    // without expanding to two-tone, rainbow or every other specialty variant.
    if (/\bbasic\b/.test(normalize(product.sku))) {
      for (const value of [product.sku, product.name]) {
        const base = normalize(value).replace(/\bbasic(?:\s+colou?r)?\b/g, "").replace(/\s+/g, " ").trim();
        if (!base || base === normalize(product.material ?? "")) continue;
        aliases.add(base);
        if (base.split(" ").length === 2) aliases.add(base.split(" ").reverse().join(" "));
      }
    }
    for (const value of [product.sku, product.name]) {
      const normalized = normalize(value);
      const hardness = [...normalized.matchAll(/\b\d{2,3}[ad]\b/g)].map(match => match[0]);
      if (hardness.length < 2) continue;
      for (const grade of hardness) aliases.add(normalized.replace(/\b\d{2,3}[ad]\b/g, "").replace(/\s+/g, " ").trim().replace(/\btpu\b/, `tpu ${grade}`));
    }
    const words = normalize(product.name).split(" ");
    if (words.length === 2) aliases.add([...words].reverse().join(" "));
    for (const alias of aliases) {
      if (!alias) continue;
      const pattern = new RegExp(`\\b${alias.split(" ").map(escape).join("\\s*")}\\b`, "g");
      for (const match of source.matchAll(pattern)) matches.push({ start: match.index, end: match.index + match[0].length, sku: product.sku });
    }
  }
  const negated = (start: number) => /\b(?:not|no|without|exclude|except|remove)\s+(?:any\s+)?$/.test(source.slice(Math.max(0, start - 35), start));
  const excludedSkus = new Set<string>();
  const excludedTerms = new Set<string>();
  const ambiguous: Array<{ term: string; options: string[] }> = [];
  const qualified: Array<{ start: number; end: number }> = [];
  const modifier = "plus|pro|silk|matte|cf|gf|wood|glow|marble|rainbow|transparent|crystal|metal|[0-9]{2,3}[ad]";
  for (const match of source.matchAll(new RegExp(`\\b(?:(${modifier})\\s+(${families})|(${families})\\s*(${modifier}))\\b`, "g"))) {
    const start = match.index, end = start + match[0].length;
    if (matches.some(value => value.start <= start && value.end >= end)) continue;
    const family = match[2] || match[3], grade = match[1] || match[4];
    qualified.push({ start, end });
    const term = `${family.toUpperCase()} ${grade === "plus" ? "Plus" : grade.toUpperCase()}`;
    const candidates = products.filter(product => normalize(product.material ?? "") === family
      && normalize(`${product.sku} ${product.name}`).split(" ").includes(grade));
    if (negated(start)) {
      excludedTerms.add(normalize(term));
      for (const product of candidates) excludedSkus.add(product.sku);
    } else if (!ambiguous.some(value => value.term === term)) ambiguous.push({ term, options: candidates.map(product => product.name) });
  }
  let exact = matches.filter(match => !qualified.some(value => value.start <= match.start && value.end >= match.end)
    && !matches.some(other => other.start <= match.start && other.end >= match.end && other.end - other.start > match.end - match.start));
  const spans = new Map<string, { start: number; end: number; skus: Set<string> }>();
  for (const match of exact) {
    const key = `${match.start}:${match.end}`;
    const span = spans.get(key) ?? { start: match.start, end: match.end, skus: new Set<string>() };
    span.skus.add(match.sku);
    spans.set(key, span);
  }
  for (const span of spans.values()) {
    if (span.skus.size < 2) continue;
    qualified.push(span);
    const term = source.slice(span.start, span.end).toUpperCase();
    if (negated(span.start)) {
      excludedTerms.add(normalize(term));
      for (const sku of span.skus) excludedSkus.add(sku);
    } else if (!ambiguous.some(value => value.term === term)) ambiguous.push({ term, options: products.filter(product => span.skus.has(product.sku)).map(product => product.name) });
  }
  exact = exact.filter(match => !qualified.some(value => value.start <= match.start && value.end >= match.end));
  for (const match of exact.filter(match => negated(match.start))) {
    excludedSkus.add(match.sku); excludedTerms.add(normalize(match.sku));
    const family = normalize(match.sku);
    if (new RegExp(`^(?:${families})$`).test(family)) for (const product of products) if (normalize(product.material ?? "") === family || normalize(product.sku).startsWith(`${family} `)) excludedSkus.add(product.sku);
  }
  const skus = new Set(exact.filter(match => !negated(match.start)).map(match => match.sku));
  for (const match of source.matchAll(new RegExp(`\\b(${families})\\b`, "g"))) {
    if (exact.some(exact => match.index >= exact.start && match.index < exact.end)) continue;
    if (qualified.some(value => match.index >= value.start && match.index < value.end)) continue;
    const family = match[1];
    if (negated(match.index)) {
      excludedTerms.add(family);
      for (const product of products) if (normalize(product.material ?? "") === family || normalize(product.sku).startsWith(`${family} `)) excludedSkus.add(product.sku);
      continue;
    }
    const candidates = products.filter(product => normalize(product.material ?? "") === family);
    const base = candidates.filter(product => normalize(product.sku) === `${family} basic` || normalize(product.sku) === family);
    const choices = base.length ? base : candidates;
    if (choices.length === 1) skus.add(choices[0].sku);
    else if (!ambiguous.some(value => value.term === family.toUpperCase())) ambiguous.push({ term: family.toUpperCase(), options: choices.map(product => product.name) });
  }
  // The compact spelling "plaplus" is common in customer inquiries.
  for (const match of source.matchAll(new RegExp(`\\b(${families})plus\\b`, "g"))) {
    if (exact.some(value => match.index >= value.start && match.index < value.end) || negated(match.index)) continue;
    const term = `${match[1].toUpperCase()} Plus`;
    if (!ambiguous.some(value => value.term === term)) ambiguous.push({ term, options: [] });
  }
  const knownWords = new Set(products.flatMap(product => [product.sku, product.name, product.material ?? ""].flatMap(value => normalize(value).split(" "))));
  const filler = new Set("please quote quotation for and or filament filaments spool spools color colors black white red blue green silk qty kg mm plus basic need want interested in products product material materials".split(" "));
  for (const line of text.split(/\r?\n/)) {
    const candidate = normalize(line.split(/[^\x00-\x7f]/)[0]);
    if ([...candidate.matchAll(new RegExp(`\\b(${families})\\b`, "g"))].length < 3) continue;
    for (const token of candidate.split(" ")) {
      if (!/^[a-z]{2,8}$/.test(token) || knownWords.has(token) || filler.has(token) || ambiguous.some(value => normalize(value.term).replaceAll(" ", "") === token)) continue;
      if (!materialNames.some(material => oneEditApart(token, material))) continue;
      ambiguous.push({ term: token.toUpperCase(), options: [] });
    }
  }
  return { productSkus: [...skus].filter(sku => !excludedSkus.has(sku)), ambiguous, excludedSkus: [...excludedSkus], excludedTerms: [...excludedTerms] };
}
