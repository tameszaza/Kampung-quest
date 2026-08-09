import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addPrivate: vi.fn(),
  addGroup: vi.fn(),
}));

vi.mock("@/server/container", () => ({
  eventCoordinator: {
    addCoordinationMessage: mocks.addPrivate,
    addGroupCoordinationMessage: mocks.addGroup,
  },
}));

vi.mock("@/server/identity/session", () => ({
  requireUser: vi.fn(async () => ({ id: "member-1" })),
}));

import { POST as postPrivateMessage } from "@/app/api/v1/event-quests/[questId]/coordination/route";
import { POST as postGroupMessage } from "@/app/api/v1/event-quests/[questId]/coordination/group/route";

function acceptedThread(messageId: string) {
  return {
    threadId: "thread-1",
    revision: 3,
    messages: [{
      messageId,
      senderId: "member-1",
      role: "participant",
      kind: "text",
      body: "Hello group",
      createdAt: "2026-08-09T06:00:00.000Z",
    }],
  };
}

function request() {
  return new Request("http://localhost/api/v1/event-quests/quest-1/coordination", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body: "Hello group",
      clientMessageId: "client-message-1",
      expectedRevision: 2,
    }),
  });
}

describe("event coordination message routes", () => {
  beforeEach(() => {
    mocks.addPrivate.mockReset();
    mocks.addGroup.mockReset();
  });

  it("acknowledges a private message without waiting for the AI reply", async () => {
    mocks.addPrivate.mockResolvedValue(acceptedThread("client-message-1"));

    const response = await postPrivateMessage(request(), { params: Promise.resolve({ questId: "quest-1" }) });

    expect(response.status).toBe(202);
    expect(response.headers.get("server-timing")).toContain("persist_message");
    expect(mocks.addPrivate).toHaveBeenCalledWith(expect.objectContaining({
      runId: "quest-1",
      actorId: "member-1",
      clientMessageId: "client-message-1",
      waitForAgent: false,
    }));
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      messages: [expect.objectContaining({ messageId: "client-message-1" })],
    }));
  });

  it("acknowledges a group message without waiting for the AI reply", async () => {
    mocks.addGroup.mockResolvedValue(acceptedThread("client-message-1"));

    const response = await postGroupMessage(request(), { params: Promise.resolve({ questId: "quest-1" }) });

    expect(response.status).toBe(202);
    expect(response.headers.get("server-timing")).toContain("persist_message");
    expect(mocks.addGroup).toHaveBeenCalledWith(expect.objectContaining({
      runId: "quest-1",
      actorId: "member-1",
      clientMessageId: "client-message-1",
      waitForAgent: false,
    }));
  });
});
