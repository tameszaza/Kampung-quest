import type { ChangeEventHandler, FormEventHandler, ReactNode } from "react";

type ChatMessageBubbleProps = {
  body: string;
  mine?: boolean;
  heading?: string;
  time?: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** The shared visual primitive for every incoming and outgoing chat message. */
export function ChatMessageBubble({ body, mine = false, heading, time, actionLabel, onAction }: ChatMessageBubbleProps) {
  const content = (
    <>
      {heading ? <strong>{heading}</strong> : null}
      <p>{body}</p>
      {time ? <time>{time}</time> : null}
      {actionLabel ? <small className="message-bubble-action">{actionLabel}</small> : null}
    </>
  );

  return (
    <div className={`message-bubble-row${mine ? " mine" : ""}`}>
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
  name?: string;
  maxLength?: number;
  children?: ReactNode;
};

/** Shared composer shell; guided conversations only supply their custom action row. */
export function ChatComposer({ onSubmit, placeholder, disabled = false, multiline = false, id = "chat-message", autoFocus = false, value, onChange, name = "message", maxLength, children }: ChatComposerProps) {
  return (
    <form className={`message-composer${multiline ? " assistant-composer" : ""}`} onSubmit={onSubmit}>
      {multiline ? <>
        <label className="sr-only" htmlFor={id}>Your answer</label>
        <textarea id={id} value={value} onChange={onChange} placeholder={placeholder} rows={1} maxLength={maxLength} disabled={disabled} autoFocus={autoFocus} />
      </> : <label><span className="sr-only">Type a message</span><input name={name} autoComplete="off" maxLength={maxLength} disabled={disabled} placeholder={placeholder} /></label>}
      {children ?? <button type="submit" aria-label="Send message" disabled={disabled}><span aria-hidden="true">➤</span></button>}
    </form>
  );
}
