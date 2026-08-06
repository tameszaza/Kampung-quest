"use client";

import { Icon } from "@/components/icons";
import { ProfileAvatar } from "@/components/profile-avatar";
import {
  actOnEventTask,
  decideEventTaskReassignment,
  respondToEventRole,
  retryEventTaskPlan,
} from "@/features/events/client";
import type { EventQuestView } from "@/server/domain/event-coordination";
import type { EventFinalRole, EventTask, EventTaskPlan } from "@/server/domain/event-tasks";

type ActivityAction = (label: string, action: () => Promise<EventQuestView>) => void;

export function EventTaskBoard({
  state,
  taskPlan,
  userId,
  organizer,
  busy,
  act,
}: {
  state: EventQuestView;
  taskPlan: EventTaskPlan;
  userId: string;
  organizer: boolean;
  busy: string;
  act: ActivityAction;
}) {
  const ready = !["generation_pending", "generation_failed"].includes(taskPlan.status);
  const approvedCount = taskPlan.tasks.filter((task) => task.status === "approved").length;
  const myRole = taskPlan.roles.find((role) => role.userId === userId);
  const teamRoles = taskPlan.roles.filter((role) => role.userId !== userId);
  const assignedTaskIds = new Set(taskPlan.roles.flatMap((role) => tasksForRole(taskPlan.tasks, role.userId).map((task) => task.taskId)));
  const unassignedTasks = taskPlan.tasks.filter((task) => !assignedTaskIds.has(task.taskId));
  const myTasks = myRole ? tasksForRole(taskPlan.tasks, myRole.userId) : [];

  return <div className="event-task-board">
    <header className="event-task-board-header">
      <div>
        <span className="section-kicker">Your event quest</span>
        <h2>Roles and tasks</h2>
        <p>See who is responsible for each part of the activity and what needs to happen next.</p>
      </div>
      {ready ? <div className="event-task-progress" aria-label={`${approvedCount} of ${taskPlan.tasks.length} tasks approved`}><strong>{approvedCount}/{taskPlan.tasks.length}</strong><span>tasks approved</span></div> : null}
    </header>

    {taskPlan.status === "generation_pending" ? <div className="event-task-state" role="status"><span className="connected-spinner" />Senior Quest is preparing a few useful tasks for everyone.</div> : null}
    {taskPlan.status === "generation_failed" ? <div className="form-alert" role="alert">Tasks could not be prepared yet.{organizer ? <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => act("retry-task-plan", () => retryEventTaskPlan(state.runId, state.revision))}>Try again</button> : null}</div> : null}

    {ready ? <>
      {myRole ? <TaskAssignment
        role={myRole}
        tasks={myTasks}
        state={state}
        userId={userId}
        busy={busy}
        act={act}
        featured
      /> : null}

      {organizer && taskPlan.reassignments.some((request) => request.status === "pending_admin") ? <PendingReassignments state={state} requests={taskPlan.reassignments.filter((request) => request.status === "pending_admin")} busy={busy} act={act} /> : null}

      {teamRoles.length ? <section className="event-task-team" aria-labelledby="event-task-team-heading">
        <div className="event-task-section-heading"><div><h3 id="event-task-team-heading">Team assignments</h3><p>Everyone’s role and tasks are grouped together below.</p></div><span>{teamRoles.length} {teamRoles.length === 1 ? "person" : "people"}</span></div>
        <div className="event-task-team-list">{teamRoles.map((role) => <TaskAssignment
          key={role.userId}
          role={role}
          tasks={tasksForRole(taskPlan.tasks, role.userId)}
          state={state}
          userId={userId}
          busy={busy}
          act={act}
        />)}</div>
      </section> : null}

      {unassignedTasks.length ? <section className="event-task-unassigned" aria-labelledby="event-task-unassigned-heading">
        <div className="event-task-section-heading"><div><h3 id="event-task-unassigned-heading">Shared tasks</h3><p>These tasks include more than one person or do not have a single role owner.</p></div></div>
        <div className="event-task-unassigned-list">{unassignedTasks.map((task) => <TaskItem key={task.taskId} task={task} state={state} userId={userId} busy={busy} act={act} />)}</div>
      </section> : null}
    </> : null}
  </div>;
}

function TaskAssignment({
  role,
  tasks,
  state,
  userId,
  busy,
  act,
  featured = false,
}: {
  role: EventFinalRole;
  tasks: EventTask[];
  state: EventQuestView;
  userId: string;
  busy: string;
  act: ActivityAction;
  featured?: boolean;
}) {
  const profile = state.participantProgress.find((candidate) => candidate.userId === role.userId);
  const name = role.userId === userId ? "You" : profile?.displayName ?? "Community member";
  const canRespond = role.userId === userId && role.status !== "acknowledged";

  return <article className={`event-task-assignment${featured ? " event-task-assignment-yours" : ""}`}>
    <div className="event-task-assignment-header">
      <ProfileAvatar name={name} photoUrl={profile?.photoUrl} size={48} />
      <div className="event-task-assignment-person"><span className="event-task-assignment-label">{featured ? "Your assignment" : name}</span><h3>{role.name}</h3><p>{role.responsibility}</p></div>
      <span className={`event-task-role-status event-task-role-status-${role.status}`}>{roleStatusLabel(role.status)}</span>
    </div>
    <dl className="event-task-role-details">
      <div><dt>Responsible for</dt><dd>{role.responsibility}</dd></div>
      <div><dt>Main contribution</dt><dd>{role.mainContribution}</dd></div>
    </dl>
    {canRespond ? <div className="event-task-role-actions"><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => act("ack-role", () => respondToEventRole({ runId: state.runId, action: "acknowledge", expectedRevision: state.revision }))}>This role works</button><button className="quiet-button" type="button" disabled={Boolean(busy)} onClick={() => act("concern-role", () => respondToEventRole({ runId: state.runId, action: "raise_concern", concern: "I need a different role or task.", expectedRevision: state.revision }))}>Raise concern</button></div> : null}
    <div className="event-task-assignment-tasks">
      <h4>{featured ? "Your tasks" : "Tasks"}</h4>
      {tasks.length ? tasks.map((task) => <TaskItem key={task.taskId} task={task} state={state} userId={userId} busy={busy} act={act} />) : <p className="event-task-empty">No task has been assigned to this role yet.</p>}
    </div>
  </article>;
}

function TaskItem({ task, state, userId, busy, act }: { task: EventTask; state: EventQuestView; userId: string; busy: string; act: ActivityAction }) {
  const assigned = task.assignees.some((assignee) => assignee.userId === userId);
  const reviewer = task.reviewerId === userId;
  const names = task.assignees.map((assignee) => assignee.userId === userId ? "You" : state.participantProgress.find((candidate) => candidate.userId === assignee.userId)?.displayName ?? "Community member");
  const showAssignees = names.length > 1 || names.some((name) => name !== "You");
  const canSubmit = assigned && ["acknowledged", "needs_retry"].includes(task.status) && ["scheduled", "in_progress"].includes(state.lifecycle);
  const canReview = reviewer && task.status === "submitted";

  return <article className={`event-task-item event-task-item-${task.status}`}>
    <div className="event-task-item-heading"><span className="event-task-difficulty">{difficultyLabel(task.difficulty)} · {task.points} points</span><span className={`event-task-status event-task-status-${task.status}`}>{task.status === "approved" ? <Icon name="check" size={15} /> : null}{taskStatusLabel(task.status)}</span></div>
    <h4>{task.title}</h4>
    <p>{task.instruction}</p>
    {showAssignees || task.reviewReason ? <div className="event-task-item-meta">{showAssignees ? <span><Icon name="people" size={16} />{names.join(", ")}</span> : null}{task.reviewReason ? <span><Icon name="shield" size={16} />Admin note: {task.reviewReason}</span> : null}</div> : null}
    {canSubmit ? <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => act(`submit-${task.taskId}`, () => actOnEventTask({ runId: state.runId, taskId: task.taskId, action: "submit", expectedRevision: state.revision }))}>Mark task done</button> : null}
    {canReview ? <div className="event-task-item-actions"><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => act(`approve-${task.taskId}`, () => actOnEventTask({ runId: state.runId, taskId: task.taskId, action: "approve", expectedRevision: state.revision }))}>Approve task</button><button className="quiet-button" type="button" disabled={Boolean(busy)} onClick={() => act(`retry-${task.taskId}`, () => actOnEventTask({ runId: state.runId, taskId: task.taskId, action: "needs_retry", reason: "Please complete the task as described.", expectedRevision: state.revision }))}>Needs changes</button></div> : null}
  </article>;
}

function PendingReassignments({ state, requests, busy, act }: { state: EventQuestView; requests: EventTaskPlan["reassignments"]; busy: string; act: ActivityAction }) {
  return <section className="event-task-review-queue" aria-labelledby="event-task-review-heading">
    <div className="event-task-section-heading"><div><h3 id="event-task-review-heading">Role changes to review</h3><p>These requests need an organizer decision.</p></div><span>{requests.length} pending</span></div>
    <div className="event-task-review-list">{requests.map((request) => {
      const profile = state.participantProgress.find((candidate) => candidate.userId === request.requesterId);
      const name = profile?.displayName ?? "Community member";
      return <article className="event-task-review-card" key={request.requestId}><div className="event-task-review-person"><ProfileAvatar name={name} photoUrl={profile?.photoUrl} size={40} /><div><strong>{name}</strong><p>{request.reason}</p>{request.replacement ? <small>Suggested replacement: {request.replacement.title}</small> : null}</div></div><div className="event-task-item-actions"><button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => act(`approve-reassignment-${request.requestId}`, () => decideEventTaskReassignment({ runId: state.runId, requestId: request.requestId, action: "approve", expectedRevision: state.revision }))}>Approve</button><button className="quiet-button" type="button" disabled={Boolean(busy)} onClick={() => act(`reject-reassignment-${request.requestId}`, () => decideEventTaskReassignment({ runId: state.runId, requestId: request.requestId, action: "reject", reason: "Please keep the current role for now.", expectedRevision: state.revision }))}>Keep current role</button></div></article>;
    })}</div>
  </section>;
}

function tasksForRole(tasks: EventTask[], userId: string) {
  return tasks.filter((task) => task.roleUserId === userId);
}

function roleStatusLabel(status: EventFinalRole["status"]) {
  if (status === "acknowledged") return "Role confirmed";
  if (status === "concern_raised") return "Needs adjustment";
  return "Needs review";
}

function taskStatusLabel(status: EventTask["status"]) {
  if (status === "assigned") return "Needs acknowledgement";
  if (status === "acknowledged") return "Ready to start";
  if (status === "submitted") return "Waiting for review";
  if (status === "approved") return "Approved";
  return "Needs changes";
}

function difficultyLabel(difficulty: EventTask["difficulty"]) {
  return difficulty.slice(0, 1).toUpperCase() + difficulty.slice(1);
}
