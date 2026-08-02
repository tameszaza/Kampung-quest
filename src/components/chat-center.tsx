"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import type { ChatContact, ChatMessage, ConversationSummary } from "@/server/identity/types";

export function ChatCenter() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? conversations.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(value))
      : conversations;
  }, [conversations, query]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/conversations", { cache: "no-store" });
      const result = await response.json() as { conversations?: ConversationSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load conversations");
      const nextConversations = result.conversations ?? [];
      setConversations(nextConversations);
      setSelectedId((current) => current ?? (window.matchMedia("(min-width: 768px)").matches ? nextConversations[0]?.id ?? null : null));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, quiet = false) => {
    if (!quiet) setMessageLoading(true);
    try {
      const response = await fetch(`/api/chat/conversations/${conversationId}/messages`, { cache: "no-store" });
      const result = await response.json() as { messages?: ChatMessage[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load messages");
      setMessages(result.messages ?? []);
      if (!quiet) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load messages");
    } finally {
      if (!quiet) setMessageLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects subscribe the
   * chat view to remote conversation state; state updates occur after fetches resolve. */
  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (!selectedId) return;
    void loadMessages(selectedId);
    const timer = window.setInterval(() => {
      void loadMessages(selectedId, true);
      void loadConversations();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [loadConversations, loadMessages, selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openConversation(id: string) {
    setSelectedId(id);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    const form = event.currentTarget;
    const input = form.elements.namedItem("message") as HTMLInputElement;
    const body = input.value.trim();
    if (!body) return;
    input.value = "";
    try {
      const response = await fetch(`/api/chat/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await response.json() as { message?: ChatMessage; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Message was not sent");
      setMessages((items) => [...items, result.message!]);
      setConversations((items) => items.map((item) => item.id === selectedId
        ? { ...item, preview: body, lastMessageAt: result.message!.createdAt }
        : item).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
      requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      input.value = body;
      setError(reason instanceof Error ? reason.message : "Message was not sent");
    }
  }

  return (
    <div className={`chat-center${selectedId ? " conversation-open" : ""}`}>
      <section className="conversation-panel" aria-label="Conversations">
        <header className="chat-list-header">
          <div><p>Your conversations</p><h1>Messages</h1></div>
          <button className="round-add" type="button" onClick={() => setCreating(true)} aria-label="Start a new conversation"><Icon name="plus" size={24} /></button>
        </header>
        <label className="message-search"><span className="sr-only">Search messages</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search messages" /></label>
        {error ? <div className="chat-alert" role="alert">{error}<button type="button" onClick={() => { setError(""); void loadConversations(); }}>Try again</button></div> : null}
        {loading ? <div className="chat-loading" role="status">Loading your conversations…</div> : null}
        {!loading && filtered.length === 0 ? (
          <div className="empty-chat-list"><span aria-hidden="true">💬</span><h2>{query ? "No messages found" : "Start a conversation"}</h2><p>{query ? "Try another name or word." : "Connect one-to-one or bring friends together in a group."}</p>{!query ? <button className="primary-button" type="button" onClick={() => setCreating(true)}>New Message</button> : null}</div>
        ) : null}
        <div className="conversation-list">
          {filtered.map((conversation) => (
            <button className={`conversation-row${selectedId === conversation.id ? " selected" : ""}`} type="button" key={conversation.id} onClick={() => openConversation(conversation.id)}>
              <Avatar src={conversation.imageUrl} name={conversation.title} size={58} group={conversation.type === "group"} />
              <span className="conversation-copy"><span><strong>{conversation.title}</strong><time>{formatThreadTime(conversation.lastMessageAt)}</time></span><small>{conversation.type === "group" ? `${conversation.memberCount} members · ` : ""}{conversation.preview}</small></span>
              {conversation.unreadCount ? <b className="unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</b> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel" aria-label={selected ? `Conversation with ${selected.title}` : "Selected conversation"}>
        {selected ? (
          <>
            <header className="chat-header">
              <button className="icon-button chat-back" type="button" onClick={() => setSelectedId(null)} aria-label="Back to conversations"><Icon name="back" /></button>
              <Avatar src={selected.imageUrl} name={selected.title} size={48} group={selected.type === "group"} />
              <span><h2>{selected.title}</h2><p>{selected.type === "group" ? `${selected.memberCount} members` : "Community member"}</p></span>
              <span className="online-label"><i /> Safe chat</span>
            </header>
            <div className="message-history" aria-live="polite" aria-busy={messageLoading}>
              <div className="chat-day-label">Today</div>
              {messageLoading ? <div className="chat-loading">Loading messages…</div> : null}
              {!messageLoading && messages.length === 0 ? <div className="empty-conversation"><span>👋</span><p>Say hello and start the conversation.</p></div> : null}
              {messages.map((message, index) => {
                const showName = selected.type === "group" && !message.mine && messages[index - 1]?.senderId !== message.senderId;
                return (
                  <div className={`message-bubble-row${message.mine ? " mine" : ""}`} key={message.id}>
                    <div className="message-bubble">
                      {showName ? <strong>{message.senderName}</strong> : null}
                      <p>{message.body}</p>
                      <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}{message.mine ? "  ✓✓" : ""}</time>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
            <form className="message-composer" onSubmit={sendMessage}>
              <label><span className="sr-only">Type a message</span><input name="message" autoComplete="off" maxLength={2000} placeholder="Type a message…" /></label>
              <button type="submit" aria-label="Send message"><span aria-hidden="true">➤</span></button>
            </form>
          </>
        ) : (
          <div className="chat-placeholder"><span aria-hidden="true">💚</span><h2>Your messages, all in one place</h2><p>Choose a conversation to read and reply.</p></div>
        )}
      </section>
      {creating ? <NewConversationSheet onClose={() => setCreating(false)} onCreated={(conversation) => { setConversations((items) => [conversation, ...items.filter((item) => item.id !== conversation.id)]); setCreating(false); openConversation(conversation.id); }} /> : null}
    </div>
  );
}

function NewConversationSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (conversation: ConversationSummary) => void }) {
  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [type, setType] = useState<"direct" | "group">("direct");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      fetch(`/api/chat/contacts${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as { contacts?: ChatContact[]; error?: string };
        if (!response.ok) throw new Error(result.error ?? "Could not load people");
        setContacts(result.contacts ?? []);
        setError("");
      })
      .catch((reason) => { if (reason instanceof Error && reason.name !== "AbortError") setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search]);

  function choose(id: string) {
    setSelected((items) => type === "direct" ? [id] : items.includes(id) ? items.filter((item) => item !== id) : [...items, id]);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected.length) { setError("Choose at least one person."); return; }
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, participantIds: selected, title: form.get("title") || undefined }),
      });
      const result = await response.json() as { conversation?: ConversationSummary; error?: string; issues?: Array<{ message: string }> };
      if (!response.ok || !result.conversation) throw new Error(result.issues?.[0]?.message ?? result.error ?? "Could not create conversation");
      onCreated(result.conversation);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create conversation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="create-sheet new-chat-sheet" onSubmit={create} role="dialog" aria-modal="true" aria-labelledby="new-chat-title">
        <div className="sheet-handle" />
        <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        <h2 id="new-chat-title">New conversation</h2>
        <p>Choose one person or create a friendly group.</p>
        <div className="chat-type-switch"><button className={type === "direct" ? "active" : ""} type="button" onClick={() => { setType("direct"); setSelected([]); }}>Direct message</button><button className={type === "group" ? "active" : ""} type="button" onClick={() => { setType("group"); setSelected([]); }}>Group chat</button></div>
        {type === "group" ? <label><span>Group name</span><input name="title" placeholder="For example, Walking Friends" required /></label> : null}
        <label className="contact-search"><span>Find by display name</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Maria Santos or maria.santos" autoComplete="off" /></label>
        {error ? <div className="form-alert" role="alert">{error}</div> : null}
        <fieldset className="contact-picker"><legend>{type === "direct" ? "Choose a person" : "Choose group members"}</legend>{loading ? <p className="contact-status">Searching…</p> : null}{!loading && contacts.length === 0 ? <p className="contact-status">No people found. Check the display name and try again.</p> : null}{contacts.map((contact) => <button className={selected.includes(contact.id) ? "selected" : ""} type="button" key={contact.id} onClick={() => choose(contact.id)}><Avatar src={contact.photoUrl} name={contact.fullName} size={44} /><span><strong>{contact.fullName}</strong>{contact.username ? <small>@{contact.username}</small> : null}</span><b>{selected.includes(contact.id) ? "✓" : "+"}</b></button>)}</fieldset>
        <button className="primary-button" disabled={busy}>{busy ? "Creating…" : type === "direct" ? "Start Chat" : `Create Group${selected.length ? ` (${selected.length + 1})` : ""}`}</button>
      </form>
    </div>
  );
}

function Avatar({ src, name, size, group = false }: { src: string | null; name: string; size: number; group?: boolean }) {
  return <span className="chat-avatar" style={{ width: size, height: size }}>{src ? <Image src={src} alt="" fill sizes={`${size}px`} /> : <span aria-hidden="true">{group ? "👥" : name.slice(0, 1).toUpperCase()}</span>}</span>;
}

function formatThreadTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
