import type { ChangeEventHandler, FormEventHandler, KeyboardEventHandler, ReactNode } from "react";

type ChatMessageBubbleProps = {
  body: string;
  mine?: boolean;
  heading?: string;
  time?: string;
  receipt?: "sending" | "delivered" | "read";
  actionLabel?: string;
  onAction?: () => void;
  variant?: "default" | "activity-card";
  label?: string | null;
};

/** The shared visual primitive for every incoming and outgoing chat message. */
export function ChatMessageBubble({ body, mine = false, heading, time, receipt, actionLabel, onAction, variant = "default", label = null }: ChatMessageBubbleProps) {
  const content = (
    <>
      {label ? <span className="message-bubble-label">{label}</span> : null}
      {heading ? <strong>{heading}</strong> : null}
      <p>{body}</p>
      {time ? <time>{time}{receipt ? <span className={`message-receipt ${receipt}`} aria-label={receipt === "sending" ? "Sending" : receipt === "read" ? "Read" : "Delivered"} title={receipt === "sending" ? "Sending" : receipt === "read" ? "Read" : "Delivered"}><span aria-hidden="true">{receipt === "sending" ? "…" : "✓"}</span>{receipt === "read" ? <span aria-hidden="true">✓</span> : null}</span> : null}</time> : null}
      {actionLabel ? <small className="message-bubble-action">{actionLabel}</small> : null}
    </>
  );

  return (
    <div className={`message-bubble-row${mine ? " mine" : ""}${variant === "activity-card" ? " activity-card" : ""}`}>
      {onAction ? <button className="message-bubble message-bubble-editable" type="button" onClick={onAction} title={actionLabel}>{content}</button> : <div className="message-bubble">{content}</div>}
    </div>
  );
}

export function ChatDayLabel({ children = "Today" }: { children?: ReactNode }) {
  return <div className="chat-day-label">{children}</div>;
}

type ChatComposerProps = {
  onSubmit: FormEventHandler<HTMLFormElement>;
  placeholder: string;
  disabled?: boolean;
  multiline?: boolean;
  id?: string;
  autoFocus?: boolean;
  value?: string;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  inputValue?: string;
  onInputChange?: ChangeEventHandler<HTMLInputElement>;
  onInputKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  name?: string;
  maxLength?: number;
  children?: ReactNode;
};

/** Shared composer shell used by direct, group, and guided conversations. */
export function ChatComposer({ onSubmit, placeholder, disabled = false, multiline = false, id = "chat-message", autoFocus = false, value, onChange, onKeyDown, inputValue, onInputChange, onInputKeyDown, name = "message", maxLength, children }: ChatComposerProps) {
  return (
    <form className="message-composer" onSubmit={onSubmit}>
      {multiline ? <>
        <label className="sr-only" htmlFor={id}>Your answer</label>
        <textarea id={id} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder} rows={1} maxLength={maxLength} disabled={disabled} autoFocus={autoFocus} />
  </> : <label><span className="sr-only">Type a message</span><input name={name} value={inputValue} onChange={onInputChange} onKeyDown={onInputKeyDown} autoComplete="off" maxLength={maxLength} disabled={disabled} placeholder={placeholder} /></label>}
      {children ?? <button className="message-composer-send" type="submit" aria-label="Send message" disabled={disabled}><span aria-hidden="true">➤</span></button>}
    </form>
  );
}
