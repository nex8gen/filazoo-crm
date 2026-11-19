"use client";

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";
import { threadKeyForEmail, type EmailThreadMetadata } from "@/lib/email-threading";

/** Consume a reply link only after its conversation and saved draft are ready. */
export function useEmailReplyLink({ pendingThreadRef, messages, ready, setExpanded, input }: {
  pendingThreadRef: RefObject<string | undefined>;
  messages: Array<EmailThreadMetadata & { id: string }>;
  ready: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  input: RefObject<{ focus(): void } | null>;
}) {
  useEffect(() => {
    const thread = pendingThreadRef.current;
    if (!thread || !ready || !messages.some(message => threadKeyForEmail(message) === thread || message.id === thread)) return;
    pendingThreadRef.current = undefined;
    setExpanded(true);
    // An unmounted editor clears its ref before this queued focus can run.
    window.setTimeout(() => input.current?.focus(), 0);
  }, [messages, ready, setExpanded, input, pendingThreadRef]);
}
