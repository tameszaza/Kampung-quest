"use client";

import Image from "next/image";
import { useAppState } from "@/components/app-state";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { messageThreads } from "@/data/mock-data";

export default function MessagesPage() {
  const { showToast } = useAppState();

  return (
    <div className="page-container narrow-page messages-page">
      <PageHeader
        title="Messages"
        right={
          <button className="round-add" type="button" onClick={() => showToast("New message flow is ready for backend wiring")} aria-label="New message">
            <Icon name="plus" size={23} />
          </button>
        }
      />
      <p className="demo-page-note"><strong>Demo preview:</strong> these conversations are examples and no real messages are sent.</p>
      <section className="message-list" aria-label="Message conversations">
        {messageThreads.map((thread) => (
          <button className="message-row" type="button" key={thread.id} onClick={() => showToast(`Opening ${thread.name}`)}>
            <span className="message-avatar"><Image src={thread.image} alt="" fill sizes="58px" /></span>
            <span className="message-copy"><strong>{thread.name}</strong><small>{thread.preview}</small></span>
            <span className="message-side"><time>{thread.time}</time>{thread.unread ? <b>{thread.unread}</b> : null}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
