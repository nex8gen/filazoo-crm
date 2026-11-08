export type VoiceRecognition = {
  continuous: boolean; interimResults: boolean; lang: string;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};

/** One user-started dictation session, with bounded recovery and no lost text. */
export function startVoiceInput(options: {
  create: () => VoiceRecognition; value: string; language: string;
  onChange: (value: string) => void; onListening: (value: boolean) => void;
  onStatus: (message: string | null) => void;
  schedule?: (callback: () => void) => () => void;
}) {
  let current: VoiceRecognition | undefined, cancelRestart: (() => void) | undefined;
  let text = options.value, restarts = 0, stopped = false;
  const schedule = options.schedule ?? (callback => { const timer = setTimeout(callback, 400); return () => clearTimeout(timer); });
  function detach() {
    if (!current) return;
    current.onresult = null; current.onerror = null; current.onend = null;
  }
  function stop() {
    stopped = true;
    cancelRestart?.();
    detach();
    current?.abort();
    current = undefined;
    options.onListening(false);
  }
  function start() {
    if (stopped) return;
    const recognition = options.create();
    current = recognition;
    const base = text.trim() ? `${text.trim()} ` : "";
    let error: string | undefined;
    recognition.continuous = true; recognition.interimResults = true; recognition.lang = options.language;
    recognition.onresult = event => {
      if (stopped || current !== recognition) return;
      text = (base + Array.from(event.results, result => result[0]?.transcript ?? "").join(" ")).slice(0, 6_000);
      options.onChange(text);
      options.onStatus(null);
    };
    recognition.onerror = event => {
      if (stopped || current !== recognition) return;
      error = event.error;
      if (["network", "no-speech"].includes(error)) return; // Restart only after the browser releases recognition.
      stop();
      if (error !== "aborted") options.onStatus(error === "not-allowed" || error === "service-not-allowed"
        ? "Allow microphone access in your browser settings, then tap the microphone. Your typed message is saved."
        : error === "audio-capture" ? "Connect a microphone, then tap the microphone button. Your typed message is saved."
        : error === "language-not-supported" ? "Choose a supported voice language or type your message. Your text is saved."
        : "Voice input paused. Your text is saved; tap the microphone to continue.");
    };
    recognition.onend = () => {
      if (stopped || current !== recognition) return;
      detach(); current = undefined;
      if (restarts++ < 2) {
        options.onStatus(error === "network" ? "Reconnecting voice input…" : null);
        cancelRestart = schedule(start);
      } else {
        stop();
        options.onStatus(error === "network" ? "Voice connection paused. Your text is saved; tap the microphone to reconnect." : "Voice input paused. Tap the microphone to continue.");
      }
    };
    try { recognition.start(); options.onListening(true); }
    catch { stop(); options.onStatus("Tap the microphone to start voice input again. Your text is saved."); }
  }
  options.onStatus(null);
  start();
  return { stop };
}
