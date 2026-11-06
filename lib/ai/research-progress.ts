import type { ResearchSource } from "./customer-research.ts";

export type ResearchProgress = {
  phase: "searching" | "reading" | "writing";
  sources: ResearchSource[];
  queries: string[];
  visitedUrls: string[];
};

type ResearchEvent = { type: "progress"; progress: ResearchProgress } | { type: "result"; status: number; data: unknown };
export const researchStreamType = "application/x-ndjson";

/** Opt-in progress streaming; ordinary callers and early HTTP errors keep JSON. */
export async function withResearchProgress(request: Request, run: (report: (progress: ResearchProgress) => void) => Promise<Response>): Promise<Response> {
  if (!request.headers.get("accept")?.includes(researchStreamType)) return run(() => {});
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let closed = false, started = false;
  const encoder = new TextEncoder();
  let resolveResponse: (response: Response) => void;
  let rejectResponse: (reason: unknown) => void;
  const response = new Promise<Response>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { closed = true; } });
  const emit = (event: ResearchEvent) => {
    if (closed) return;
    if (!started) {
      started = true;
      resolveResponse(new Response(stream, { headers: { "Content-Type": `${researchStreamType}; charset=utf-8`, "Cache-Control": "private, no-store, no-transform", "Content-Encoding": "identity", "X-Accel-Buffering": "no" } }));
    }
    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  };
  void run(progress => emit({ type: "progress", progress })).then(async result => {
    if (!started) resolveResponse(result);
    else if (!closed) emit({ type: "result", status: result.status, data: await result.json() });
    if (!closed) { closed = true; controller.close(); }
  }).catch(error => {
    if (!started) rejectResponse(error);
    else if (!closed) { closed = true; controller.error(new Error("The research connection ended. Please retry.")); }
  });
  return response;
}

/** Decode real source updates while retaining compatibility with saved JSON replies. */
export async function readResearchResponse<T>(response: Response, onProgress: (progress: ResearchProgress) => void): Promise<T> {
  if (!response.headers.get("content-type")?.includes(researchStreamType)) return response.json() as Promise<T>;
  if (!response.body) throw new Error("The research connection ended. Please retry.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result: T | undefined, completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ResearchEvent;
    if (event.type === "progress") onProgress(event.progress);
    if (event.type === "result") {
      if (event.status >= 400) throw new Error((event.data as { error?: string })?.error || "Unable to complete research. Please retry.");
      result = event.data as T; completed = true;
    }
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1_000_000) throw new Error("The research response was too large. Please retry.");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) { consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!completed) throw new Error("The research connection ended before the answer was complete. Please retry.");
    return result!;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
