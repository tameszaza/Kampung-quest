import { z } from "zod";

export type EventTaskPlanStatus =
  | "generation_pending"
  | "awaiting_acknowledgement"
  | "active"
  | "generation_failed"
  | "suspended"
  | "superseded";

export type EventTaskDifficulty = "easy" | "medium" | "hard";
export type EventTaskStatus = "assigned" | "acknowledged" | "submitted" | "approved" | "needs_retry";
export type EventRoleStatus = "pending" | "acknowledged" | "concern_raised";

export const EVENT_TASK_POINTS: Record<EventTaskDifficulty, number> = {
  easy: 10,
  medium: 20,
  hard: 30,
};

export interface EventFinalRole {
  userId: string;
  name: string;
  responsibility: string;
  mainContribution: string;
  status: EventRoleStatus;
  concern: string | null;
  acknowledgedAt: string | null;
  updatedAt: string;
}

export interface EventTaskAssignee {
  userId: string;
  acknowledgedAt: string | null;
}

export interface EventTask {
  taskId: string;
  title: string;
  instruction: string;
  roleUserId: string;
  reviewerId: string;
  difficulty: EventTaskDifficulty;
  points: number;
  status: EventTaskStatus;
  assignees: EventTaskAssignee[];
  submittedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventTaskReassignment {
  requestId: string;
  taskId: string;
  requesterId: string;
  reason: string;
  replacement: {
    title: string;
    instruction: string;
    difficulty: EventTaskDifficulty;
  } | null;
  status: "pending_admin" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventTaskPlan {
  planId: string;
  rosterRevision: number;
  arrangementVersion: number;
  questGoalHash: string;
  status: EventTaskPlanStatus;
  roles: EventFinalRole[];
  tasks: EventTask[];
  reassignments: EventTaskReassignment[];
  generationAttempts: number;
  generationError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventRewardEntry {
  entryId: string;
  userId: string;
  runId: string;
  taskId: string;
  points: number;
  kind: "task_award" | "reversal";
  reversesEntryId: string | null;
  actorId: string;
  reason: string | null;
  createdAt: string;
}

export const eventTaskDifficultySchema = z.enum(["easy", "medium", "hard"]);

export const eventTaskPlanAgentOutputSchema = z.object({
  roles: z.array(z.object({
    userId: z.string().min(1),
    name: z.string().trim().min(1).max(40),
    responsibility: z.string().trim().min(1).max(120),
    mainContribution: z.string().trim().min(1).max(120).optional(),
  })),
  tasks: z.array(z.object({
    title: z.string().trim().min(1).max(60),
    instruction: z.string().trim().min(1).max(180),
    roleUserId: z.string().min(1).optional(),
    difficulty: eventTaskDifficultySchema,
    assigneeIds: z.array(z.string().min(1)).min(1).max(5),
  })).min(3).max(5),
});

export type EventTaskPlanAgentOutput = z.infer<typeof eventTaskPlanAgentOutputSchema>;

export const eventTaskReassignmentAgentOutputSchema = z.object({
  title: z.string().trim().min(1).max(60),
  instruction: z.string().trim().min(1).max(180),
  difficulty: eventTaskDifficultySchema,
});

export interface EventTaskPlanAgentInput {
  organizerId: string;
  quest: {
    title: string;
    goal: string;
    description: string;
    durationMinutes: number;
  };
  participants: Array<{
    userId: string;
    proposedRole: string;
    contributions: string[];
    requirements: string[];
  }>;
  appointment: {
    venueName: string;
  };
}

export interface EventTaskPlanParticipant {
  userId: string;
  proposedRole: string;
  contributions: string[];
  requirements: string[];
}

export interface EventTaskReassignmentAgentInput {
  task: Pick<EventTask, "title" | "instruction" | "difficulty" | "assignees">;
  participant: {
    userId: string;
    role: string;
    contributions: string[];
  };
  reason: string;
}

export const eventTaskActionSchema = z.object({
  action: z.enum(["submit", "approve", "needs_retry", "reverse"]),
  reason: z.string().trim().max(300).optional(),
  expectedRevision: z.number().int().positive(),
});

export const eventRoleResponseSchema = z.object({
  action: z.enum(["acknowledge", "raise_concern"]),
  concern: z.string().trim().max(300).optional(),
  expectedRevision: z.number().int().positive(),
});

export const eventTaskPlanRetrySchema = z.object({
  expectedRevision: z.number().int().positive(),
});

export const eventTaskReassignmentDecisionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(300).optional(),
  expectedRevision: z.number().int().positive(),
});

export function pointsForDifficulty(difficulty: EventTaskDifficulty): number {
  return EVENT_TASK_POINTS[difficulty];
}

export function normalizeEventTaskPlanReviewers(
  output: EventTaskPlanAgentOutput,
  activeUserIds: string[],
  organizerId: string,
): EventTaskPlanAgentOutput {
  const tasks = output.tasks.map((task, taskIndex) => {
    if (!task.assigneeIds.includes(organizerId)) return task;
    const independentReviewer = activeUserIds.find((userId) =>
      userId !== organizerId && !task.assigneeIds.includes(userId));
    if (independentReviewer) return task;

    const roleUserId = task.roleUserId ?? task.assigneeIds[0];
    const reviewerCandidates = activeUserIds.filter((userId) =>
      userId !== organizerId && task.assigneeIds.includes(userId));
    const reviewerId = reviewerCandidates[taskIndex % reviewerCandidates.length];
    if (!reviewerId) return task;

    return {
      ...task,
      assigneeIds: roleUserId === organizerId
        ? task.assigneeIds.filter((userId) => userId !== reviewerId)
        : task.assigneeIds.filter((userId) => userId !== organizerId),
    };
  });

  return {
    ...output,
    tasks,
  };
}

export function validateEventTaskPlan(
  output: EventTaskPlanAgentOutput,
  activeParticipants: string[] | EventTaskPlanParticipant[],
  organizerId: string,
): string[] {
  const errors: string[] = [];
  const participants: EventTaskPlanParticipant[] = activeParticipants.map((participant) =>
    typeof participant === "string"
      ? { userId: participant, proposedRole: "", contributions: [], requirements: [] }
      : participant,
  );
  const activeUserIds = participants.map((participant) => participant.userId);
  const active = new Set(activeUserIds);
  const roleIds = new Set(output.roles.map((role) => role.userId));
  const participantById = new Map(participants.map((participant) => [participant.userId, participant]));
  const assigned = new Set<string>();
  const taskKeys = new Set<string>();

  if (output.roles.length !== activeUserIds.length) errors.push("Every active participant needs exactly one final role");
  for (const userId of activeUserIds) {
    if (!roleIds.has(userId)) errors.push(`Missing final role for ${userId}`);
  }
  if (roleIds.size !== output.roles.length) errors.push("A participant cannot have more than one final role");

  for (const task of output.tasks) {
    const key = `${task.title.toLowerCase()}|${task.instruction.toLowerCase()}`;
    if (taskKeys.has(key)) errors.push("Tasks must be distinct");
    taskKeys.add(key);
    const roleUserId = task.roleUserId ?? task.assigneeIds[0];
    if (!roleUserId || !active.has(roleUserId)) errors.push("Every task needs a related active role");
    if (roleUserId && !task.assigneeIds.includes(roleUserId)) errors.push("The related role owner must be assigned to the task");
    const taskText = `${task.title} ${task.instruction}`.toLowerCase();
    if (/\b(private home|home address|share medical|medical history|medication|bank account|password|give money|carry someone)\b/i.test(taskText)) {
      errors.push("Tasks must not request private information or unsafe personal work");
    }
    if (/^(help|assist|support|handle|do)\s+(with|the activity|it|things)\b/i.test(task.instruction.trim())) {
      errors.push("Tasks must state a specific useful action");
    }
    const roleOwner = roleUserId ? participantById.get(roleUserId) : undefined;
    const requirements = roleOwner?.requirements ?? [];
    if (requirements.some((requirement) => /no[_ -]?stairs|step[_ -]?free|wheelchair|no[_ -]?lifting|avoid[_ -]?crowds/i.test(requirement))
      && /stairs?|steps?|lift|lifting|carry|crowd/i.test(taskText)) {
      errors.push("Tasks must not conflict with confirmed participant requirements");
    }
    for (const userId of task.assigneeIds) {
      if (!active.has(userId)) errors.push("Tasks may only be assigned to active participants");
      assigned.add(userId);
    }
    if (task.assigneeIds.includes(organizerId)
      && !activeUserIds.some((userId) => userId !== organizerId && !task.assigneeIds.includes(userId))) {
      errors.push("An organizer task needs a separate participant verifier");
    }
  }
  for (const userId of activeUserIds) {
    if (!assigned.has(userId)) errors.push(`Every active participant needs at least one task: ${userId}`);
  }
  return [...new Set(errors)];
}
