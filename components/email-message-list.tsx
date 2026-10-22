"use client";

import { Fragment } from "react";
import { Paperclip, Reply, Star } from "lucide-react";
import type { EmailWorkspaceItem } from "./email-inbox";

type Conversation = { id: string; messages: EmailWorkspaceItem[]; latest: EmailWorkspaceItem };

function dateGroup(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Earlier";
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" });
}

export function EmailMessageList({ conversations, compact, activeId, checked, readMessages, starred, onCheck, onOpen, onStar }: {
  conversations: Conversation[];
  compact: boolean;
  activeId?: string;
  checked: Set<string>;
  readMessages: Set<string>;
  starred: Set<string>;
  onCheck: (id: string) => void;
  onOpen: (item: Conversation) => void;
  onStar: (id: string) => void;
}) {
  if (!conversations.length) return <div className="m-5 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No conversations match this view. Try another folder or clear your filters.</div>;
  return <div className={compact ? "mail-rows mail-rows-compact" : "mail-rows"}>
    {conversations.map((item, index) => {
      const email = item.latest;
      const unread = item.messages.some((message) => message.direction === "inbound" && !readMessages.has(message.id));
      const group = dateGroup(email.timestamp);
      const date = new Date(email.timestamp);
      const time = Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      return <Fragment key={item.id}>
        {index === 0 || dateGroup(conversations[index - 1].latest.timestamp) !== group ? <h3 className="mail-date-group">{group}</h3> : null}
        <div className="mail-row" data-active={activeId === item.id} data-unread={unread}>
          <input type="checkbox" aria-label={`Select ${email.subject}`} checked={checked.has(item.id)} onChange={() => onCheck(item.id)} />
          <button type="button" className="mail-row-open" onClick={() => onOpen(item)} aria-label={`Open ${email.subject}`}>
            <span className="mail-unread-dot" aria-label={unread ? "Unread" : undefined} />
            <span className="mail-sender truncate">{email.contactName || email.contact}{item.messages.length > 1 ? <span className="ml-1 text-muted-foreground">({item.messages.length})</span> : null}{email.contactName && email.contactName !== email.contact ? <span className="mail-sender-address ml-2 border-l pl-2 font-normal text-muted-foreground">{email.contact}</span> : null}</span>
            <span className="mail-summary"><span className="mail-subject">{email.subject || "(No subject)"}</span><span className="mail-preview">{email.preview ? ` — ${email.preview}` : ""}</span></span>
            <span className="mail-indicators">{email.attachments?.length ? <Paperclip className="size-3.5" /> : null}{item.messages.some((message) => message.direction === "outbound") ? <Reply className="size-3.5 text-emerald-600" /> : null}</span>
            <time dateTime={email.timestamp} title={date.toLocaleString()}>{time}</time>
          </button>
          <button type="button" className={`mail-star ${starred.has(email.id) ? "text-amber-500" : "text-muted-foreground"}`} aria-label={`${starred.has(email.id) ? "Unstar" : "Star"} ${email.subject}`} onClick={() => onStar(email.id)}><Star className="size-3.5" fill={starred.has(email.id) ? "currentColor" : "none"} /></button>
        </div>
      </Fragment>;
    })}
  </div>;
}
