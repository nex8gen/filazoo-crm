import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { Parser } from "htmlparser2";
import { leadDomain, type BusinessPage } from "./ai-leads.ts";
import { publicResearchUrl } from "./ai/customer-research.ts";

export function publicBusinessAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return isIP(address) === 6 && /^[23][a-f\d]{3}:/i.test(address) && !/^2001:(?:0*:|db8:|0?2:)/i.test(address);
}
const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true }).then(async found => {
    let addresses = found;
    // Local proxy DNS can use benchmarking addresses. Resolve independently,
    // validate the answers and pin the socket; never connect to those addresses.
    if (addresses.length && addresses.every(item => /^198\.(?:18|19)\./.test(item.address))) {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { Accept: "application/dns-json" }, redirect: "error", signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error("Public DNS unavailable.");
      const result = await response.json() as { Answer?: Array<{ type: number; data: string }> };
      addresses = (result.Answer ?? []).filter(item => item.type === 1 && isIP(item.data) === 4).map(item => ({ address: item.data, family: 4 }));
    }
    if (!addresses.length || addresses.some(item => !publicBusinessAddress(item.address))) throw new Error("Only public business websites can be read.");
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }).catch((error: Error) => callback(error, "", 4));
};

export function parseBusinessPage(html: string, url: string): BusinessPage {
  const chunks: string[] = [], links: string[] = [], mail: string[] = [], phones: string[] = [];
  let hidden = 0;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (["script", "style", "noscript", "svg"].includes(name)) hidden++;
      if (hidden) return;
      if (name === "a" && attrs.href) {
        const href = attrs.href.trim();
        if (/^mailto:/i.test(href)) { try { mail.push(decodeURIComponent(href.slice(7).split("?")[0])); } catch { /* Invalid mail link. */ } }
        else if (/^tel:/i.test(href)) phones.push(href.slice(4).trim());
        else {
          try { const target = new URL(href, url); target.hash = ""; if (publicResearchUrl(target.href) && leadDomain(target.href) === leadDomain(url)) links.push(target.href); } catch { /* Invalid link. */ }
        }
      }
      chunks.push(" ");
    },
    ontext(value) { if (!hidden) chunks.push(value); },
    onclosetag(name) { if (["script", "style", "noscript", "svg"].includes(name)) hidden = Math.max(0, hidden - 1); if (!hidden) chunks.push(" "); },
  }, { decodeEntities: true });
  parser.write(html); parser.end();
  const text = chunks.join(" ").replace(/\s+/g, " ").trim().slice(0, 45000);
  const emails = [...new Set([...mail, ...(text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) ?? [])].map(value => value.trim().toLowerCase()))]
    .filter(value => /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(value) && value.length <= 254 && !/\.(png|jpg|jpeg|svg|webp)$/i.test(value) && !/@(?:example\.(?:com|org)|sentry\.io)$/i.test(value)).slice(0, 10);
  return { url, text, emails, phones: [...new Set(phones.filter(value => /^[+\d().\s-]{7,35}$/.test(value) && value.replace(/\D/g, "").length >= 7))].slice(0, 5), links: [...new Set(links)].slice(0, 100) };
}

export async function readBusinessPage(input: string, signal: AbortSignal, allowedDomain = leadDomain(input), redirects = 0): Promise<BusinessPage> {
  const safe = publicResearchUrl(input);
  if (!safe || !allowedDomain || leadDomain(safe) !== allowedDomain || redirects > 3) throw new Error("Website cannot be read safely.");
  const url = new URL(safe);
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsGet : httpGet)(url, { lookup: pinnedLookup, signal, headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "CRM-Lead-Research/1.0", "Accept-Encoding": "identity" } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        void readBusinessPage(new URL(response.headers.location, url).href, signal, allowedDomain, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200 || !/text\/html|application\/xhtml\+xml/i.test(response.headers["content-type"] ?? "")) { response.resume(); reject(new Error("Website did not return a public HTML page.")); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 750000) request.destroy(new Error("Website page is too large.")); else chunks.push(chunk); });
      response.on("end", () => resolve(parseBusinessPage(Buffer.concat(chunks).toString("utf8"), url.href)));
      response.on("error", reject);
    });
    request.setTimeout(8000, () => request.destroy(new Error("Website timed out.")));
    request.on("error", reject);
  });
}

export async function readBusinessWebsite(website: string, signal: AbortSignal, keywords: string[] = []): Promise<BusinessPage[]> {
  const first = await readBusinessPage(website, signal);
  // Use an actual contact page and the most relevant application/material page,
  // rather than spending both reads on generic About/Legal pages.
  const contact = first.links.find(url => /contact|kontakt|impressum|contatt|contac|nous-joindre/i.test(new URL(url).pathname));
  const words = [...new Set(keywords.flatMap(value => value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))].filter(word => !["the","and","for","with","that","from","this","used","product","products"].includes(word));
  const score = (url: string) => {const path=new URL(url).pathname.toLowerCase();return words.reduce((sum,word)=>sum+(path.includes(word)?4:0),0)+(/services|materials|solutions|applications|capabilities|printing|manufactur|leistungen|materialien|3d-druck/.test(path)?2:0);};
  const relevant = first.links.filter(url=>url!==contact&&new URL(url).pathname!=="/").sort((a,b)=>score(b)-score(a)).find(url=>score(url)>0)
    || first.links.find(url=>url!==contact&&/about|company|a-propos|legal/i.test(new URL(url).pathname));
  const selected = [...new Set([contact,relevant].filter((url):url is string=>Boolean(url)))];
  const more = await Promise.allSettled(selected.map(url => readBusinessPage(url, signal, leadDomain(website))));
  return [first, ...more.flatMap(item => item.status === "fulfilled" ? [item.value] : [])];
}
