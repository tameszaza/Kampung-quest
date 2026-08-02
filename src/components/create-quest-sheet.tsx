"use client";

import { useState, type FormEvent, type MouseEvent } from "react";
import { Icon } from "@/components/icons";
import { useAppState } from "@/components/app-state";

export function CreateQuestSheet() {
  const { createQuestOpen, closeCreateQuest, showToast } = useAppState();
  const [submitted, setSubmitted] = useState(false);

  if (!createQuestOpen) return null;

  function close() {
    setSubmitted(false);
    closeCreateQuest();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    showToast("Your quest draft was created");
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={close}>
      <section
        className="create-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-quest-title"
        onMouseDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        <button className="icon-button sheet-close" type="button" onClick={close} aria-label="Close">
          <Icon name="close" size={22} />
        </button>

        {submitted ? (
          <div className="sheet-success">
            <span><Icon name="check" size={36} strokeWidth={2.4} /></span>
            <h2 id="create-quest-title">Quest draft ready</h2>
            <p>This placeholder flow is complete. A backend can be connected later.</p>
            <button className="primary-button" type="button" onClick={close}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <span className="sheet-icon"><Icon name="plus" size={28} /></span>
            <h2 id="create-quest-title">Create a Quest</h2>
            <p>Start a friendly activity and invite nearby members.</p>
            <label>
              Quest name
              <input required name="title" placeholder="Example: Tea and a friendly chat" />
            </label>
            <label>
              Activity type
              <select name="type" defaultValue="social">
                <option value="social">Social & companionship</option>
                <option value="wellness">Wellness & movement</option>
                <option value="learning">Learning & skills</option>
              </select>
            </label>
            <button className="primary-button" type="submit">Continue</button>
          </form>
        )}
      </section>
    </div>
  );
}
