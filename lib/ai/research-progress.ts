import type { ResearchSource } from "./customer-research.ts";

export type ResearchProgress = {
  phase: "searching" | "reading" | "writing";
  sources: ResearchSource[];
  queries: string[];
  visitedUrls: string[];
};

export type AssistantActivity = { id: string; label: string; detail?: string; status: "active" | "complete" | "failed"; durationMs?: number };
export type TrackActivity = <T>(label: string, run: () => Promise<T>, detail?: string) => Promise<T>;
type ResearchEvent = { type: "progress"; progress: ResearchProgress } | { type: "activity"; activity: AssistantActivity[] } | { type: "result"; status: number; data: unknown };
export const researchStreamType = "application/x-ndjson";

/** Opt-in progress streaming; ordinary callers and early HTTP errors keep JSON. */
export async function withResearchProgress(request: Request, run: (report: (progress: ResearchProgress) => void, track: TrackActivity, activity: readonly AssistantActivity[]) => Promise<Response>): Promise<Response> {
  if (!request.headers.get("accept")?.includes(researchStreamType)) return run(() => {}, (_label, work) => work(), []);
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
  const activity: AssistantActivity[] = [];
  const update = () => emit({ type: "activity", activity });
  const track: TrackActivity = async (label, work, detail) => {
    const step: AssistantActivity = { id: `activity-${activity.length}`, label, detail, status: "active" };
    const start = Date.now();
    activity.push(step); update();
    try {
      const result = await work();
      step.status = "complete";
      return result;
    } catch (error) {
      step.status = "failed";
      throw error;
    } finally { step.durationMs = Date.now() - start; update(); }
  };
  let researchStep: AssistantActivity | undefined;
  let researchPhase: ResearchProgress["phase"] | undefined;
  const report = (progress: ResearchProgress) => {
    if (researchPhase !== progress.phase) {
      if (researchStep) researchStep.status = "complete";
      researchStep = undefined;
      if (progress.phase !== "writing") {
        researchStep = { id: `activity-${activity.length}`, label: progress.phase === "searching" ? "Searching the web" : "Reading company websites", status: "active" };
        activity.push(researchStep);
      }
      researchPhase = progress.phase;
    }
    if (researchStep) researchStep.detail = progress.phase === "searching" ? progress.queries.at(-1) : progress.visitedUrls.at(-1);
    update();
    emit({ type: "progress", progress });
  };
  void run(report, track, activity).then(async result => {
    for (const step of activity) if (step.status === "active") step.status = result.ok ? "complete" : "failed";
    if (activity.length) update();
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
export async function readResearchResponse<T>(response: Response, onProgress: (progress: ResearchProgress) => void, onActivity?: (activity: AssistantActivity[]) => void): Promise<T> {
  if (!response.headers.get("content-type")?.includes(researchStreamType)) return response.json() as Promise<T>;
  if (!response.body) throw new Error("The research connection ended. Please retry.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", result: T | undefined, completed = false;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ResearchEvent;
    if (event.type === "progress") onProgress(event.progress);
    if (event.type === "activity") onActivity?.(event.activity);
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
