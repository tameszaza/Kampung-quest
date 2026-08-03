"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AssistantConversation } from "@/components/assistant-conversation";
import { ChatComposer, ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { Icon } from "@/components/icons";
import { useAppState } from "@/components/app-state";
import type { ChatContact, ChatMessage, ConversationSummary } from "@/server/identity/types";

export const ASSISTANT_CONVERSATION_ID = "senior-quest-assistant";

const assistantConversation: ConversationSummary = {
  id: ASSISTANT_CONVERSATION_ID,
  type: "direct",
  title: "Senior Quest",
  imageUrl: null,
  preview: "Your friendly community helper",
  // Keep the server-rendered assistant row deterministic. A live timestamp here
  // is rendered once on the server and once in the browser (often in different
  // time zones), which causes a hydration mismatch before conversations load.
  lastMessageAt: "now",
  unreadCount: 0,
  memberCount: 1,
};

export function ChatCenter({ initialConversation }: { initialConversation?: "assistant" }) {
  const { showToast } = useAppState();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversation === "assistant" ? ASSISTANT_CONVERSATION_ID : null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantResetToken, setAssistantResetToken] = useState(0);
  const [confirmAction, setConfirmAction] = useState<"leave" | "block" | "delete" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const assistantSelected = selectedId === ASSISTANT_CONVERSATION_ID;
  const activeConversation = assistantSelected ? assistantConversation : selected;
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const items = [assistantConversation, ...conversations];
    return value
      ? items.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(value))
      : items;
  }, [conversations, query]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/conversations", { cache: "no-store" });
      const result = await response.json() as { conversations?: ConversationSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load conversations");
      const nextConversations = result.conversations ?? [];
      setConversations(nextConversations);
      setSelectedId((current) => current ?? (window.matchMedia("(min-width: 768px)").matches ? nextConversations[0]?.id ?? ASSISTANT_CONVERSATION_ID : null));
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
    if (!selectedId || assistantSelected) return;
    void loadMessages(selectedId);
    const timer = window.setInterval(() => {
      void loadMessages(selectedId, true);
      void loadConversations();
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [assistantSelected, loadConversations, loadMessages, selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openConversation(id: string) {
    setSelectedId(id);
    if (id === ASSISTANT_CONVERSATION_ID) setMessages([]);
    setMenuOpen(false);
    setConfirmAction(null);
    setConversations((items) => items.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || assistantSelected || selected?.blocked) return;
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

  async function completeChatAction(actionOverride?: "unblock") {
    if (!selected || actionBusy) return;
    const action = actionOverride ?? confirmAction;
    if (!action) return;
    setActionBusy(true);
    try {
      const response = action === "block"
        ? (selected.otherUserId
          ? await fetch("/api/chat/blocks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ userId: selected.otherUserId }),
          })
          : null)
        : action === "unblock"
          ? (selected.otherUserId
            ? await fetch("/api/chat/blocks", {
              method: "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ userId: selected.otherUserId }),
            })
            : null)
        : await fetch(`/api/chat/conversations/${selected.id}`, {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action }),
        });
      if (!response) throw new Error("This conversation is missing its contact details");
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "That action could not be completed");
      if (action === "block" || action === "unblock") {
        setConversations((items) => items.map((item) => item.id === selected.id ? { ...item, blocked: action === "block" } : item));
      } else {
        setConversations((items) => items.filter((item) => item.id !== selected.id));
        setSelectedId(null);
        setMessages([]);
      }
      setConfirmAction(null);
      setMenuOpen(false);
      showToast(action === "leave" ? "You left the group" : action === "delete" ? "Chat deleted for you" : action === "unblock" ? "User unblocked. You can message again" : "User blocked. Your chat history is preserved");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That action could not be completed");
    } finally {
      setActionBusy(false);
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
              {conversation.id === ASSISTANT_CONVERSATION_ID ? <AssistantAvatar size={58} /> : <Avatar src={conversation.imageUrl} name={conversation.title} size={58} group={conversation.type === "group"} />}
              <span className="conversation-copy"><span><strong>{conversation.title}</strong><time>{formatThreadTime(conversation.lastMessageAt)}</time></span><small>{conversation.type === "group" ? `${conversation.memberCount} members · ` : ""}{conversation.preview}</small></span>
              {conversation.unreadCount ? <b className="unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</b> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel" aria-label={activeConversation ? `Conversation with ${activeConversation.title}` : "Selected conversation"}>
        {activeConversation ? (
          <>
            <div className="chat-header-stack">
              <header className="chat-header">
                <button className="icon-button chat-back" type="button" onClick={() => setSelectedId(null)} aria-label="Back to conversations"><Icon name="back" /></button>
                {assistantSelected ? <AssistantAvatar size={48} /> : <Avatar src={activeConversation.imageUrl} name={activeConversation.title} size={48} group={activeConversation.type === "group"} />}
                <span><h2>{activeConversation.title}</h2><p>{assistantSelected ? "Your friendly community helper" : activeConversation.type === "group" ? `${activeConversation.memberCount} members` : "Community member"}</p></span>
                <div className="chat-header-actions">
                  <button
                    className="chat-more-button"
                    type="button"
                    onClick={() => { setMenuOpen((open) => !open); setConfirmAction(null); }}
                    aria-label="More chat options"
                    aria-expanded={menuOpen}
                  >
                    <span aria-hidden="true">⋮</span>
                  </button>
                </div>
              </header>
              {menuOpen ? <div className="chat-options-menu" role="menu" aria-label={assistantSelected ? "Senior Quest options" : "Chat options"}>
                {assistantSelected ? <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setAssistantResetToken((value) => value + 1); }}><Icon name="refresh" size={18} /> Start over</button> : <>
                  {activeConversation.type === "group" ? <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmAction("leave"); }}><Icon name="close" size={18} /> Leave group</button> : activeConversation.blocked ? <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void completeChatAction("unblock"); }}><Icon name="blocked" size={18} /> Unblock user</button> : <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmAction("block"); }}><Icon name="blocked" size={18} /> Block user</button>}
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setConfirmAction("delete"); }}><Icon name="trash" size={18} /> Delete chat</button>
                </>}
              </div> : null}
              {!assistantSelected && confirmAction ? (
                <div className="chat-action-confirm" role="alertdialog" aria-label={`${confirmAction} confirmation`}>
                  <div><strong>{confirmAction === "leave" ? `Leave ${activeConversation.title}?` : confirmAction === "delete" ? "Delete this chat?" : `Block ${activeConversation.title}?`}</strong><p>{confirmAction === "leave" ? "You will no longer receive messages from this group." : confirmAction === "delete" ? "This removes the chat from your list. Other people keep their history." : "Your current chat history stays here. New messages will be blocked."}</p></div>
                  <div className="chat-action-confirm-buttons"><button type="button" className="quiet-button" onClick={() => setConfirmAction(null)} disabled={actionBusy}>Keep chat</button><button type="button" className="danger-button" onClick={() => void completeChatAction()} disabled={actionBusy}>{actionBusy ? "Please wait…" : confirmAction === "leave" ? "Leave group" : confirmAction === "delete" ? "Delete chat" : "Block user"}</button></div>
                </div>
              ) : null}
            </div>
            {assistantSelected ? <AssistantConversation embedded resetToken={assistantResetToken} /> : <>
            <div className="message-history" aria-live="polite" aria-busy={messageLoading}>
              <ChatDayLabel />
              {messageLoading ? <div className="chat-loading">Loading messages…</div> : null}
              {!messageLoading && messages.length === 0 ? <div className="empty-conversation"><span>👋</span><p>Say hello and start the conversation.</p></div> : null}
              {messages.map((message, index) => {
                const showName = activeConversation.type === "group" && !message.mine && messages[index - 1]?.senderId !== message.senderId;
                return <ChatMessageBubble
                  key={message.id}
                  body={message.body}
                  mine={message.mine}
                  heading={showName ? message.senderName : undefined}
                  time={formatMessageTime(message.createdAt)}
                  receipt={message.mine ? (message.receipt ?? "delivered") : undefined}
                />;
              })}
              <div ref={bottomRef} />
            </div>
            <ChatComposer
              onSubmit={sendMessage}
              maxLength={2000}
              disabled={activeConversation.blocked}
              placeholder={activeConversation.blocked ? "Chat blocked — unblock in Settings to message" : "Type a message…"}
            />
            </>}
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

function AssistantAvatar({ size }: { size: number }) {
  return <span className="chat-avatar assistant-chat-avatar" style={{ width: size, height: size }} aria-hidden="true">♥</span>;
}

function Avatar({ src, name, size, group = false }: { src: string | null; name: string; size: number; group?: boolean }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return <span className="chat-avatar" style={{ width: size, height: size }}>{showImage ? <Image src={src!} alt="" fill sizes={`${size}px`} onError={() => setFailed(true)} /> : <span aria-hidden="true">{group ? "👥" : name.slice(0, 1).toUpperCase()}</span>}</span>;
}

function formatThreadTime(value: string) {
  if (value === "now") return "Now";
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatMessageTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
