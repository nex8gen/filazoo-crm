export function emailTextHtml(text: string) {
  return escapeEmailHtml(text).replace(/\n/g, "<br>");
}

export function escapeEmailHtml(text: string) {
  return text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Email-safe layout and text styles; URL-bearing CSS is never retained. */
export function emailSafeStyle(input: string) {
  const rules: Record<string, RegExp> = {
    color: /^(?:#[a-f\d]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\))$/i,
    "background-color": /^(?:#[a-f\d]{3,8}|[a-z]{1,20}|rgba?\([\d\s.,%]+\))$/i,
    "font-weight": /^(?:normal|bold|[1-9]00)$/,
    "font-style": /^(?:normal|italic)$/,
    "font-size": /^(?:[8-9]|[1-6]\d|7[0-2])(?:px|pt)$/,
    "font-family": /^[a-zA-Z\s,'"-]{1,100}$/,
    "text-align": /^(?:left|right|center|justify)$/,
    "text-decoration": /^(?:none|underline|line-through)$/,
    "vertical-align": /^(?:top|middle|bottom|baseline)$/,
    width: /^(?:\d{1,3}|1[01]\d\d|1200)(?:px|%)$/,
    padding: /^(?:[0-9]|[1-3]\d|40)px(?:\s+(?:[0-9]|[1-3]\d|40)px){0,3}$/,
    "border-collapse": /^(?:collapse|separate)$/,
    "white-space": /^(?:normal|pre-wrap)$/,
    margin: /^(?:0(?:cm|in)?|(?:[0-9]|[1-3]\d|40)(?:px|pt))(?:\s+(?:0(?:cm|in)?|(?:[0-9]|[1-3]\d|40)(?:px|pt))){0,3}$/,
    "line-height": /^(?:normal|1(?:\.\d{1,2})?|2|(?:[8-9]|[1-6]\d|7[0-2])(?:px|pt)|(?:\d{1,2}|1\d{2}|200)%)$/,
  };
  return input.split(";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon < 0) return [];
    const name = declaration.slice(0, colon).trim().toLowerCase(), value = declaration.slice(colon + 1).trim();
    return rules[name]?.test(value) ? [`${name}:${value}`] : [];
  }).join(";");
}
