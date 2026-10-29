import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import type { LookupFunction } from "node:net";
import sharp from "sharp";

export function publicImageAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  return isIP(address) === 6 && /^[23][a-f\d]{3}:/i.test(address) && !/^2001:(?:0*:|db8:|0?2:)/i.test(address);
}

export function publicImageUrl(input: string) {
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port)) || /(?:^|\.)(?:localhost|local|internal)$/i.test(host) || (isIP(host) && !publicImageAddress(host))) throw new Error("Use a public image URL.");
  return url;
}

/** Resolve and validate the address in the connection's lookup callback, which
 * prevents DNS rebinding between validation and the actual network request. */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  void lookup(hostname, { all: true }).then(async (localAddresses) => {
    let addresses = localAddresses;
    // Some local network proxies return RFC 2544 synthetic DNS addresses.
    // Resolve those names independently, then pin the connection to the actual
    // public address; never permit a synthetic/private destination itself.
    if (addresses.length && addresses.every((item) => /^198\.(?:18|19)\./.test(item.address))) {
      const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, { headers: { Accept: "application/dns-json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error("Unable to load this image. Upload its original file instead.");
      const dns = await response.json() as { Answer?: Array<{ type: number; data: string }> };
      addresses = (dns.Answer || []).filter((answer) => answer.type === 1 && isIP(answer.data) === 4).map((answer) => ({ address: answer.data, family: 4 }));
    }
    if (!addresses.length || addresses.some((item) => !publicImageAddress(item.address))) throw new Error("Use a public image URL.");
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }).catch((error: Error) => callback(error, "", 4));
};

async function imageBytes(input: string, redirects = 0): Promise<Buffer> {
  const url = publicImageUrl(input);
  if (redirects > 4) throw new Error("The image redirected too many times.");
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsGet : httpGet)(url, { lookup: publicLookup, headers: { Accept: "image/png,image/jpeg,image/gif,image/webp", Referer: `${url.origin}/`, "User-Agent": "Filazoo-Email-Image/1.0" } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        response.resume();
        void imageBytes(new URL(response.headers.location, url).href, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error("This image requires access from its original email. Copy the image itself or upload its original file.")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 5_000_000) { request.destroy(new Error("Footer images must total 5 MB or less.")); return; }
        chunks.push(chunk);
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.setTimeout(10_000, () => request.destroy(new Error("The image took too long to load. Copy the image itself or upload its original file.")));
    request.on("error", reject);
  });
}

export async function importRemoteEmailImage(url: string) {
  const bytes = await imageBytes(url);
  const metadata = await sharp(bytes, { animated: true, limitInputPixels: 40_000_000 }).metadata();
  if (!metadata.format || !["png", "jpeg", "gif", "webp"].includes(metadata.format)) throw new Error("Choose a PNG, JPG, GIF, or WebP image.");
  return `data:image/${metadata.format};base64,${bytes.toString("base64")}`;
}
