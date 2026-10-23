"use client";

import { memo, useEffect, useRef, useState } from "react";

function sharedPrefix(previous: string, next: string) {
  let length = 0;
  while (length < previous.length && length < next.length && previous[length] === next[length]) length++;
  return next.slice(0, length);
}

export const EmailAiTypewriter = memo(function EmailAiTypewriter({ text, updating }: { text: string; updating: boolean }) {
  const [revealed, setRevealed] = useState("");
  const revealedRef = useRef("");
  const visible = text.startsWith(revealed) ? revealed : sharedPrefix(revealed, text);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let started: number | undefined;
    // Keep unchanged text in place and reveal only the revised suffix.
    const prefix = sharedPrefix(revealedRef.current, text);
    const remaining = Array.from(text.slice(prefix.length));
    const duration = Math.min(1800, remaining.length * 12);
    const tick = (now: number) => {
      started ??= now;
      const progress = motion.matches || duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const count = Math.floor(remaining.length * progress);
      const next = prefix + remaining.slice(0, count).join("");
      revealedRef.current = next;
      setRevealed(next);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [text]);

  return (
    <div className="email-ai-typewriter">
      <span className="sr-only">{text}</span>
      <div className="email-ai-typewriter-layout" aria-hidden="true">
        <p className="email-ai-typewriter-measure">{text || "\u200b"}</p>
        <p className="email-ai-typewriter-text">{visible}{updating || visible !== text ? <span className="email-ai-cursor" /> : null}</p>
      </div>
    </div>
  );
});
