"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AssistantConversation } from "@/components/assistant-conversation";
import { KampungLogo } from "@/components/kampung-logo";
import { ChatComposer, ChatDayLabel, ChatMessageBubble } from "@/components/chat-message";
import { ChatProfileDialog } from "@/components/chat-profile-dialog";
import { EventCoordinationConversation } from "@/components/event-coordination-conversation";
import { Icon } from "@/components/icons";
import { MobileMoreButton } from "@/components/mobile-more-menu";
import { useAppState } from "@/components/app-state";
import { useActivityBadges } from "@/components/activity-badge-context";
import { getQuestRun } from "@/features/assistant/client";
import { getEventCoordinationThread, getEventGroupCoordinationThread, getEventQuest } from "@/features/events/client";
import { latestChatMessage } from "@/features/events/conversation-preview";
import { visibleConversationSummaries } from "@/features/events/conversation-projection";
import { isLocalAvatarUrl } from "@/lib/avatar-url";
import type { EventActivityCard } from "@/server/domain/event-coordination";
import type { ChatContact, ChatMessage, ChatMessageSync, ChatProfile, ConversationSummary } from "@/server/identity/types";
import type { AssistantConversationSnapshot } from "@/server/domain/schemas";

export const ASSISTANT_CONVERSATION_ID = "senior-quest-assistant";
const ACTIVITY_CONVERSATION_PREFIX = "activity:";
const CONVERSATION_REFRESH_INTERVAL_MS = 15_000;
const MESSAGE_REFRESH_INTERVAL_MS = 2_000;

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

export function ChatCenter({ initialConversation, initialQuest, startNewAssistant = false }: { initialConversation?: "assistant"; initialQuest?: string; startNewAssistant?: boolean }) {
  const { showToast } = useAppState();
  const { activities: activityFeed } = useActivityBadges();
  const initialActivityId = initialQuest ? `${ACTIVITY_CONVERSATION_PREFIX}${initialQuest}` : null;
  const [activitySummaries, setActivitySummaries] = useState<ConversationSummary[]>(() => initialQuest ? [activitySummary(initialQuest)] : []);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [assistant, setAssistant] = useState<ConversationSummary>(assistantConversation);
  const [selectedId, setSelectedId] = useState<string | null>(initialActivityId ?? (initialConversation === "assistant" ? ASSISTANT_CONVERSATION_ID : null));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [messageLoading, setMessageLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [activityScope, setActivityScope] = useState<"private" | "group">("private");
  const [activityHasGroupThread, setActivityHasGroupThread] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [assistantResetToken, setAssistantResetToken] = useState(0);
  const [confirmAction, setConfirmAction] = useState<"leave" | "block" | "delete" | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [profile, setProfile] = useState<ChatProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef(selectedId);
  const messageSyncByConversationRef = useRef(new Map<string, { cursor: string | null; hasMore: boolean }>());
  const messageCacheRef = useRef(new Map<string, ChatMessage[]>());
  const messageLoadsInFlightRef = useRef(new Set<string>());
  const activityLoadInFlightRef = useRef(false);
  const hydratedActivityIdsRef = useRef(new Set<string>());
  const readGroupActivityIdsRef = useRef(new Set<string>());
  const handleActivityTitle = useCallback((runId: string, title: string, memberCount: number) => {
    setActivitySummaries((items) => {
      const id = `${ACTIVITY_CONVERSATION_PREFIX}${runId}`;
      const current = items.find((item) => item.id === id);
      if (!current || (current.title === title && current.memberCount === memberCount)) return items;
      return items.map((item) => item.id === id ? { ...item, title, memberCount } : item);
    });
  }, []);

  const activityRunId = selectedId?.startsWith(ACTIVITY_CONVERSATION_PREFIX) ? selectedId.slice(ACTIVITY_CONVERSATION_PREFIX.length) : null;
  const handleSelectedActivityTitle = useCallback((title: string, memberCount: number) => {
    if (activityRunId) handleActivityTitle(activityRunId, title, memberCount);
  }, [activityRunId, handleActivityTitle]);
  const activitySelected = Boolean(activityRunId);
  const selected = conversations.find((item) => item.id === selectedId) ?? null;
  const assistantSelected = selectedId === ASSISTANT_CONVERSATION_ID;
  const activeConversation = activitySelected
    ? activitySummaries.find((item) => item.id === selectedId) ?? (activityRunId ? activitySummary(activityRunId) : null)
    : assistantSelected ? assistant : selected;
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    const items = visibleConversationSummaries(activitySummaries, assistant, conversations);
    return value
      ? items.filter((item) => `${item.title} ${item.preview}`.toLowerCase().includes(value))
      : items;
  }, [activitySummaries, assistant, conversations, query]);

  const loadActivityConversations = useCallback(async () => {
    if (activityLoadInFlightRef.current) return;
    activityLoadInFlightRef.current = true;
    try {
      if (!activityFeed) return;
      const activities = activityFeed;
      const cards = uniqueActivityCards([
        ...(initialQuest ? [activityCardPlaceholder(initialQuest)] : []),
        ...activities.my.awaitingCoordination,
        ...activities.my.awaitingConfirmation,
        ...activities.my.upcoming,
        ...activities.invitations.map((invitation) => invitation.activity),
        ...activities.sentInvitations.map((invitation) => invitation.activity),
      ]);
      const cardsToHydrate = cards.filter((card) => !hydratedActivityIdsRef.current.has(card.runId));
      cardsToHydrate.forEach((card) => hydratedActivityIdsRef.current.add(card.runId));
      const hydrated = await Promise.all(cardsToHydrate.map((card) => toActivitySummary(
        card,
        readGroupActivityIdsRef.current.has(card.runId) ? 0 : activities.groupChatUnread[card.runId] ?? 0,
      )));
      const cardsById = new Map(cards.map((card) => [`${ACTIVITY_CONVERSATION_PREFIX}${card.runId}`, card]));
      setActivitySummaries((current) => {
        const base = hydrated.length ? mergeActivitySummaries(current, hydrated, initialQuest) : current;
        let changed = base !== current;
        const updated = base.map((item) => {
          const card = cardsById.get(item.id);
          if (!card) return item;
          const unreadCount = readGroupActivityIdsRef.current.has(card.runId)
            ? 0
            : activities.groupChatUnread[card.runId] ?? 0;
          if (item.title === card.title && item.unreadCount === unreadCount) return item;
          changed = true;
          return { ...item, title: card.title, unreadCount };
        });
        return changed ? updated : current;
      });
    } catch {
      // The normal chat list remains usable if the activity feed is unavailable.
    } finally {
      activityLoadInFlightRef.current = false;
    }
  }, [activityFeed, initialQuest]);

  const loadConversations = useCallback(async (refreshAssistant = false) => {
    try {
      const response = await fetch("/api/chat/conversations", { cache: "no-store" });
      const result = await response.json() as { conversations?: ConversationSummary[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load conversations");
      const nextConversations = (result.conversations ?? []).filter((conversation) =>
        conversation.type !== "quest_private" && conversation.type !== "quest_group");
      setConversations(nextConversations);
      if (refreshAssistant) {
        const assistantResponse = await fetch("/api/v1/assistant/conversations", { cache: "no-store" });
        if (assistantResponse.ok) {
          const snapshot = await assistantResponse.json() as AssistantConversationSnapshot | null;
          const latest = snapshot?.messages.at(-1);
          if (latest && snapshot) setAssistant({ ...assistantConversation, preview: latest.content, lastMessageAt: snapshot.updatedAt });
        }
      }
      setSelectedId((current) => {
        const next = current ?? (window.matchMedia("(min-width: 768px)").matches ? nextConversations[0]?.id ?? ASSISTANT_CONVERSATION_ID : null);
        selectedIdRef.current = next;
        return next;
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load conversations");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, quiet = false) => {
    if (messageLoadsInFlightRef.current.has(conversationId)) return;
    messageLoadsInFlightRef.current.add(conversationId);
    const cachedMessages = messageCacheRef.current.get(conversationId);
    if (!quiet && !cachedMessages) setMessageLoading(true);
    const knownSync = messageSyncByConversationRef.current.get(conversationId);
    const fetchPage = async (cursor?: string | null) => {
      const query = cursor ? `?after=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`/api/chat/conversations/${conversationId}/messages${query}`, { cache: "no-store" });
      const result = await response.json() as { messages?: ChatMessage[]; sync?: ChatMessageSync; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not load messages");
      return result;
    };
    try {
      let result;
      try {
        result = await fetchPage(knownSync?.cursor);
      } catch (reason) {
        if (!knownSync?.cursor) throw reason;
        // A stale cursor can happen after a deployment, data restore, or a
        // conversation being recreated. One full snapshot safely re-baselines
        // the stream instead of leaving the UI permanently stale.
        messageSyncByConversationRef.current.delete(conversationId);
        result = await fetchPage();
      }
      const sync = result.sync ?? { mode: "snapshot" as const, cursor: null, hasMore: false, resetRequired: false };
      const current = messageCacheRef.current.get(conversationId) ?? [];
      const next = sync.mode === "delta" && !sync.resetRequired
        ? mergeChatMessages(current, result.messages ?? [])
        : mergeChatMessages([], result.messages ?? []);
      messageCacheRef.current.set(conversationId, next);
      messageSyncByConversationRef.current.set(conversationId, { cursor: sync.cursor, hasMore: sync.hasMore });
      if (selectedIdRef.current !== conversationId) return;
      setMessages(next);
      if (!quiet) requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      if (selectedIdRef.current === conversationId) setError(reason instanceof Error ? reason.message : "Could not load messages");
    } finally {
      messageLoadsInFlightRef.current.delete(conversationId);
      if (!quiet && selectedIdRef.current === conversationId) setMessageLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- These effects subscribe the
   * chat view to remote conversation state; state updates occur after fetches resolve. */
  useEffect(() => { void loadConversations(true); }, [loadConversations]);
  useEffect(() => {
    void loadActivityConversations();
  }, [loadActivityConversations]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadConversations();
    }, CONVERSATION_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [loadConversations]);
  useEffect(() => {
    if (!selectedId || assistantSelected || activitySelected) return;
    void loadMessages(selectedId);
    const timer = window.setInterval(() => {
      void loadMessages(selectedId, true);
    }, MESSAGE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activitySelected, assistantSelected, loadConversations, loadMessages, selectedId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function openConversation(id: string) {
    selectedIdRef.current = id;
    setMessages(messageCacheRef.current.get(id) ?? []);
    setSelectedId(id);
    if (id === ASSISTANT_CONVERSATION_ID || id.startsWith(ACTIVITY_CONVERSATION_PREFIX)) setMessages([]);
    if (id.startsWith(ACTIVITY_CONVERSATION_PREFIX)) {
      setActivityScope("private");
      setActivityHasGroupThread(false);
    }
    setMenuOpen(false);
    setConfirmAction(null);
    if (!id.startsWith(ACTIVITY_CONVERSATION_PREFIX)) {
      setActivitySummaries((items) => items.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
    }
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
    const optimisticId = `pending:${crypto.randomUUID()}`;
    const optimisticMessage: ChatMessage = {
      id: optimisticId,
      conversationId: selectedId,
      senderId: "current-user",
      senderName: "You",
      senderImageUrl: null,
      body,
      createdAt: new Date().toISOString(),
      mine: true,
    };
    const optimisticMessages = mergeChatMessages(messageCacheRef.current.get(selectedId) ?? [], [optimisticMessage]);
    messageCacheRef.current.set(selectedId, optimisticMessages);
    setMessages(optimisticMessages);
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    try {
      const response = await fetch(`/api/chat/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await response.json() as { message?: ChatMessage; sync?: ChatMessageSync; error?: string };
      if (!response.ok || !result.message) throw new Error(result.error ?? "Message was not sent");
      const confirmedMessages = mergeChatMessages(
        (messageCacheRef.current.get(selectedId) ?? []).filter((message) => message.id !== optimisticId),
        [result.message],
      );
      messageCacheRef.current.set(selectedId, confirmedMessages);
      if (selectedIdRef.current === selectedId) {
        setMessages(confirmedMessages);
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
      setConversations((items) => items.map((item) => item.id === selectedId
        ? { ...item, preview: body, lastMessageAt: result.message!.createdAt }
        : item).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)));
    } catch (reason) {
      const rolledBackMessages = (messageCacheRef.current.get(selectedId) ?? []).filter((message) => message.id !== optimisticId);
      messageCacheRef.current.set(selectedId, rolledBackMessages);
      if (selectedIdRef.current === selectedId) setMessages(rolledBackMessages);
      if (!input.value) input.value = body;
      setError(reason instanceof Error ? reason.message : "Message was not sent");
    }
  }

  function markGroupActivityRead(runId: string) {
    readGroupActivityIdsRef.current.add(runId);
    const activityConversationId = `${ACTIVITY_CONVERSATION_PREFIX}${runId}`;
    setActivitySummaries((items) => items.map((item) => item.id === activityConversationId ? { ...item, unreadCount: 0 } : item));
  }

  async function openChatProfile(userId: string | null | undefined, conversationId: string) {
    if (!userId) return;
    setProfileLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/profiles/${encodeURIComponent(userId)}?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      const result = await response.json() as { profile?: ChatProfile; error?: string };
      if (!response.ok || !result.profile) throw new Error(result.error ?? "Could not load this profile");
      setProfile(result.profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this profile");
    } finally {
      setProfileLoading(false);
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
        selectedIdRef.current = null;
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
          <div className="chat-list-title"><MobileMoreButton /><div><p>Your conversations</p><h1>Messages</h1></div></div>
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
              <span className="conversation-copy"><span><strong>{conversation.title}</strong><time>{formatThreadTime(conversation.lastMessageAt)}</time></span><small>{conversation.id.startsWith(ACTIVITY_CONVERSATION_PREFIX) ? "Activity planning · " : conversation.type === "group" ? `${memberLabel(conversation.memberCount)} · ` : ""}{conversation.preview}</small></span>
              {conversation.unreadCount ? <b className="unread-badge" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</b> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="chat-panel" aria-label={activeConversation ? `Conversation with ${activeConversation.title}` : "Selected conversation"}>
        {activitySelected && activityRunId && activeConversation ? <>
          <div className="chat-header-stack">
            <header className="chat-header activity-chat-header">
              <button className="icon-button chat-back" type="button" onClick={() => { selectedIdRef.current = null; setSelectedId(null); }} aria-label="Back to conversations"><Icon name="back" /></button>
              <Link className="chat-header-identity" href={`/quests/${encodeURIComponent(activityRunId)}`} aria-label={`Open ${activeConversation.title} quest details`}>
                <Avatar src={activeConversation.imageUrl} name={activeConversation.title} size={48} group />
                <span><h2>{activeConversation.title}</h2><p>{memberLabel(activeConversation.memberCount)} · Activity planning</p></span>
              </Link>
              <div className="chat-header-actions">
                {activityHasGroupThread ? <div className="chat-scope-tabs" role="tablist" aria-label="Activity chat type">
                  <button type="button" role="tab" aria-selected={activityScope === "private"} onClick={() => setActivityScope("private")}>Private</button>
                  <button type="button" role="tab" aria-selected={activityScope === "group"} onClick={() => { setActivityScope("group"); markGroupActivityRead(activityRunId); }}>Group</button>
                </div> : null}
                <button
                  className="chat-more-button"
                  type="button"
                  onClick={() => { setMenuOpen((open) => !open); setConfirmAction(null); }}
                  aria-label="More activity options"
                  aria-expanded={menuOpen}
                >
                  <span aria-hidden="true">⋮</span>
                </button>
              </div>
            </header>
            {menuOpen ? <div className="chat-options-menu" role="menu" aria-label="Activity options">
              <a href={`/quests/${encodeURIComponent(activityRunId)}`} role="menuitem"><Icon name="quests" size={18} /> Activity details</a>
              <a href="/my-quests" role="menuitem"><Icon name="calendar" size={18} /> My Activities</a>
            </div> : null}
          </div>
          <EventCoordinationConversation
            runId={activityRunId}
            embedded
            showHeader={false}
            scope={activityScope}
            onScopeChange={(nextScope) => {
              setActivityScope(nextScope);
              if (nextScope === "group" && activityRunId) {
                const activityConversationId = `${ACTIVITY_CONVERSATION_PREFIX}${activityRunId}`;
                readGroupActivityIdsRef.current.add(activityRunId);
                setActivitySummaries((items) => items.map((item) => item.id === activityConversationId ? { ...item, unreadCount: 0 } : item));
              }
            }}
            onGroupAvailabilityChange={setActivityHasGroupThread}
            onBack={() => { selectedIdRef.current = null; setSelectedId(null); }}
            onTitle={handleSelectedActivityTitle}
          />
        </> : activeConversation ? (
          <>
            <div className="chat-header-stack">
              <header className="chat-header">
                <button className="icon-button chat-back" type="button" onClick={() => { selectedIdRef.current = null; setSelectedId(null); }} aria-label="Back to conversations"><Icon name="back" /></button>
                {assistantSelected ? <AssistantAvatar size={48} /> : activeConversation.type === "direct" ? <button className="chat-profile-trigger" type="button" onClick={() => void openChatProfile(activeConversation.otherUserId, activeConversation.id)} aria-label={`Open ${activeConversation.title}'s profile`}><Avatar src={activeConversation.imageUrl} name={activeConversation.title} size={48} /></button> : <Avatar src={activeConversation.imageUrl} name={activeConversation.title} size={48} group />}
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
            {assistantSelected ? <AssistantConversation embedded resetToken={assistantResetToken} startFresh={startNewAssistant} /> : <>
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
                  receipt={message.id.startsWith("pending:") ? "sending" : message.mine ? (message.receipt ?? "delivered") : undefined}
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
      {profileLoading ? <div className="profile-loading" role="status">Loading profile…</div> : null}
      {profile ? <ChatProfileDialog profile={profile} onClose={() => setProfile(null)} /> : null}
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
  return <span className="chat-avatar assistant-chat-avatar" style={{ width: size, height: size }} aria-hidden="true"><KampungLogo size={size} /></span>;
}

function Avatar({ src, name, size, group = false }: { src: string | null; name: string; size: number; group?: boolean }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return <span className="chat-avatar" style={{ width: size, height: size }}>{showImage ? <Image src={src!} alt="" fill sizes={`${size}px`} unoptimized={isLocalAvatarUrl(src)} onError={() => setFailed(true)} /> : <span aria-hidden="true">{group ? "👥" : name.slice(0, 1).toUpperCase()}</span>}</span>;
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

function memberLabel(count: number) {
  return `${count} member${count === 1 ? "" : "s"}`;
}

function mergeChatMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  if (!incoming.length) return current;
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}

function activitySummary(runId: string): ConversationSummary {
  return {
    id: `${ACTIVITY_CONVERSATION_PREFIX}${runId}`,
    type: "group",
    title: "Activity coordination",
    imageUrl: null,
    preview: "Plan this activity with Senior Quest",
    lastMessageAt: "now",
    unreadCount: 0,
    memberCount: 0,
  };
}

function uniqueActivityCards(cards: EventActivityCard[]) {
  return [...new Map(cards.map((card) => [card.runId, card])).values()];
}

function activityCardPlaceholder(runId: string): EventActivityCard {
  return {
    runId,
    title: "Activity coordination",
    description: "Plan this activity with Senior Quest.",
    lifecycle: "forming",
    durationMinutes: 0,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Singapore",
    provisionalAvailability: null,
    workingArrangement: null,
    finalArrangement: null,
    recruitment: null,
  };
}

async function toActivitySummary(card: EventActivityCard, groupChatUnread: number): Promise<ConversationSummary> {
  const [run, view, thread, groupThread] = await Promise.all([
    getQuestRun(card.runId).catch(() => null),
    getEventQuest(card.runId).catch(() => null),
    getEventCoordinationThread(card.runId).catch(() => null),
    getEventGroupCoordinationThread(card.runId).catch(() => null),
  ]);
  const latestMessage = latestChatMessage(thread?.messages ?? [], groupThread?.messages ?? []);
  return {
    id: `${ACTIVITY_CONVERSATION_PREFIX}${card.runId}`,
    type: "group",
    title: card.title,
    imageUrl: run?.imageUrl ?? null,
    preview: latestMessage?.body ?? "Activity planning · Open to coordinate",
    lastMessageAt: latestMessage?.createdAt ?? thread?.updatedAt ?? groupThread?.updatedAt ?? view?.updatedAt ?? card.finalArrangement?.start ?? card.provisionalAvailability?.start ?? "now",
    unreadCount: groupChatUnread,
    memberCount: view?.participantProgress.length ?? 0,
  };
}

function mergeActivitySummaries(current: ConversationSummary[], next: ConversationSummary[], initialQuest?: string) {
  const merged = new Map(current.map((item) => [item.id, item]));
  for (const item of next) merged.set(item.id, item);
  if (initialQuest && !merged.has(`${ACTIVITY_CONVERSATION_PREFIX}${initialQuest}`)) {
    merged.set(`${ACTIVITY_CONVERSATION_PREFIX}${initialQuest}`, activitySummary(initialQuest));
  }
  return [...merged.values()].sort((left, right) => right.lastMessageAt.localeCompare(left.lastMessageAt));
}
