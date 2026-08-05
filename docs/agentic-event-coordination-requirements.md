# Agentic Event Coordination Requirements

## 1. Purpose

Senior Quest must provide two complementary spaces for coordinating an activity:

1. a private coordination chat between each participant and Senior Quest; and
2. a shared group chat containing all accepted participants and Senior Quest.

Messages in either space must be able to produce real, durable changes to the activity. The agent must behave as an active coordinator rather than only acknowledging messages or extracting notes.

## 2. Product principles

- There is one authoritative activity and appointment state shared by both chat surfaces.
- Private and group chat have equal access to the activity action engine, subject to the same authorization rules.
- A compatible appointment change is applied immediately to the current working appointment.
- An appointment is final only after every active participant has confirmed the same appointment version.
- If a request conflicts with participant requirements, the agent must not apply it. It must suggest the closest compatible compromise.
- Private participant information must influence coordination without being exposed to other participants.
- Ordinary group conversation should remain human-to-human unless the agent has a useful coordination reason to intervene.

## 3. Definitions

### 3.1 Working appointment

The latest non-final activity arrangement, including its date, start and end time, duration, venue, and applicable public notes. It may change during coordination.

### 3.2 Final appointment

A working appointment version that every active participant has explicitly confirmed.

### 3.3 Compatible request

A requested appointment change that satisfies all confirmed participant constraints and deterministic activity rules, including availability, accessibility, travel, venue, duration, safety, and capacity requirements.

### 3.4 Material change

A change to date, time, duration, venue, participant roster, activity type, core purpose, accessibility, or safety conditions. A material change creates a new appointment version and invalidates confirmations affected by that change.

## 4. Chat surfaces

### 4.1 Private coordination

- Every accepted participant, including the organizer, must have a private activity-scoped conversation with Senior Quest.
- Only that participant and authorized Senior Quest services may read the conversation.
- A participant may share availability, accessibility needs, travel limits, dietary or environmental requirements, venue preferences, temporary conflicts, and other coordination information.
- A participant may request an authorized appointment change from the private chat.
- The agent may use private confirmed requirements when evaluating group compatibility.
- The group must never be told which participant or private requirement prevented a request.

### 4.2 Group chat

- One group chat must exist for each activity after at least one guest accepts an invitation.
- The group chat must contain the organizer, all accepted active participants, and Senior Quest.
- Membership must follow activity membership. Withdrawn, replaced, or cancelled participants must lose access.
- Human participants may talk to one another normally.
- Senior Quest must observe every new group message for coordination intent.
- Senior Quest must respond when a message:
  - directly addresses or asks the agent a question;
  - expresses an appointment or scheduling preference;
  - requests an activity change;
  - confirms or rejects the current appointment; or
  - creates or reveals a detectable conflict.
- Senior Quest should remain silent during ordinary social conversation that has no coordination consequence.

### 4.3 Shared state across chats

- Private coordination and group chat must call the same authorization, interpretation, validation, mutation, and audit services.
- A change made from either chat must update the same working appointment.
- Successful changes and relevant status changes must appear in the group chat as structured activity updates.
- Private chats may show participant-specific explanations and next steps, but must not maintain a separate appointment state.

## 5. Agent action behavior

### 5.1 Intent interpretation

For each relevant message, Senior Quest must produce a validated structured intent rather than directly editing stored data from free text.

Supported intents must include:

- request date or time change;
- request venue change;
- request duration change;
- add or update a personal requirement;
- confirm the current appointment;
- reject or report inability to attend the current appointment;
- ask for activity status or outstanding confirmations;
- request roster change, cancellation, or completion; and
- ordinary conversation or unsupported request.

The structured result must include the requested fields, confidence, actor, source chat, activity ID, and appointment version the message was based on.

### 5.2 Immediate appointment changes

When an accepted participant requests a date, time, venue, or duration change:

1. Resolve ambiguous dates and times using the activity timezone and conversation context.
2. Validate the proposed complete appointment against all confirmed participant requirements and activity rules.
3. If compatible, atomically create and activate a new working appointment version.
4. Invalidate confirmations affected by the material change.
5. Record the actor, source message, structured intent, validation result, and state diff in the audit log.
6. Publish a structured change card to the group chat.
7. Notify participants whose confirmation is now required.
8. Reply to the requesting participant with the exact updated appointment and confirmation status.

The agent must not ask the requester for an additional confirmation when the request is sufficiently unambiguous and authorized.

### 5.3 Incompatible requests and compromises

If the requested appointment conflicts with any confirmed requirement or activity rule:

- Do not change the working appointment.
- Calculate compatible alternatives near the requested option.
- Rank alternatives by closeness to the request and overall fit for the group.
- Suggest the best compromise in the originating chat.
- Explain the conflict only in aggregate, for example: “That time does not work for the whole group.”
- Never identify the participant, private preference, medical need, accessibility detail, exact address, or internal score responsible for the conflict.
- Allow the requester to accept the suggested compromise in natural language. Acceptance must run through the same validation and mutation flow.

If no compatible alternative exists, the agent must clearly state which non-private category is blocking progress and ask for a broader preference or organizer action.

### 5.4 Confirmation and finalization

- Each appointment version must maintain a confirmation record for every active participant.
- A participant may confirm through either private coordination or group chat.
- Confirmation applies only to the exact appointment version visible when the participant confirms.
- A stale confirmation command must not confirm a newer appointment version.
- The organizer is subject to the same final appointment confirmation requirement as other participants.
- The appointment becomes final only when every active participant has confirmed the current version.
- On finalization, the activity must transition to `scheduled` and a final appointment card must be published to the group chat and private chats.
- Any later material change must create a new version, move the activity out of its finalized state, and collect confirmations again.

## 6. Permissions

### 6.1 Accepted participants

Any accepted active participant may:

- request a date, time, duration, or venue change;
- share or update their own private requirements;
- confirm or reject the current appointment;
- ask the agent for status, compatibility, or alternatives; and
- use these capabilities from either private coordination or group chat.

### 6.2 Organizer-only actions

Only the organizer may:

- add, remove, replace, approve, or reject participants;
- withdraw or cancel invitations;
- cancel the activity;
- mark the activity in progress or completed; and
- change the activity type or core purpose.

Unauthorized requests must not mutate state. The agent must explain the relevant permission boundary and, where appropriate, tell the requester what the organizer needs to do.

## 7. Requirements and preference handling

- Chat-derived personal requirements must be stored as structured, versioned participant requirements.
- The agent may immediately record an unambiguous requirement stated by its owner; the reply must show what was recorded and allow correction.
- Ambiguous, high-impact, or safety-sensitive requirements must be clarified before becoming authoritative.
- Changing a confirmed requirement must trigger compatibility recalculation for the current working appointment.
- If a requirement change makes the working appointment incompatible, the agent must retain the requirement, flag the appointment as needing adjustment, and propose a compatible alternative.
- Raw chat text must not be the authoritative source used by the scheduling validator.

## 8. Appointment state and versioning

Each appointment version must contain at minimum:

- immutable version ID and sequence number;
- activity ID;
- start and end timestamps with timezone;
- duration;
- venue identity, public name, address or directions, and verification status;
- participant roster version;
- participant requirement versions used for validation;
- status: `working`, `finalized`, `superseded`, or `rejected`;
- material diff from the preceding version;
- source chat and source message ID;
- requesting actor;
- validation result;
- confirmation records; and
- creation and update timestamps.

Exactly one working or finalized appointment version may be current at a time.

## 9. User experience requirements

- The activity screen must provide a clear switch between `Private coordination` and `Group chat`.
- The private chat header must state that personal details are private.
- The group chat header must show participants and indicate that Senior Quest can coordinate the activity from the conversation.
- Appointment mutations must render as structured cards, not only prose messages.
- A change card must show the previous and new public appointment values, who requested the change, why it was accepted in privacy-safe terms, and whose confirmations remain outstanding.
- A rejected request must remain visually distinct from an applied change.
- The current appointment and its status—working, awaiting confirmations, or final—must be visible without searching through chat history.
- Pending confirmation controls must be available beside the current appointment and inside relevant chat cards.
- Agent processing, validation, success, conflict, and failure states must be explicit. The UI must never imply that a change succeeded before the transaction commits.

## 10. Reliability, safety, and audit requirements

- All mutations must be authorized and deterministically validated by application code after agent interpretation.
- The language model must never write directly to appointment, membership, or confirmation storage.
- Mutations must be atomic and use optimistic concurrency against the current appointment and activity revisions.
- Every command must include an idempotency key so retries cannot create duplicate versions, messages, or notifications.
- Group updates, notifications, appointment versions, confirmation invalidation, and audit events must commit in one transaction or through a transactional outbox.
- If a message was interpreted against stale state, the system must re-evaluate it against the latest state or ask the user to restate the request; it must not silently overwrite a newer decision.
- Agent failures must leave the appointment unchanged and return a recoverable error.
- All agent interpretations and mutations must be auditable without exposing private requirements in group-visible records.

## 11. Acceptance criteria

### 11.1 Compatible private-chat change

Given an accepted participant privately asks, “Move it to 11 AM,” and 11 AM satisfies all confirmed requirements, the system creates a new working appointment version, updates the activity immediately, invalidates affected confirmations, posts a privacy-safe group change card, and requests confirmation from all active participants.

### 11.2 Compatible group-chat change

Given an accepted participant makes the same request in group chat, the same authorization, validation, mutation, notification, and confirmation behavior occurs.

### 11.3 Incompatible request

Given a requested time conflicts with at least one private confirmed requirement, the appointment remains unchanged and Senior Quest suggests the nearest compatible alternative without identifying the affected participant or requirement.

### 11.4 Natural-language compromise acceptance

Given Senior Quest suggests a compatible alternative and the requester replies, “Okay, use that,” the system resolves the reference to that exact suggestion, revalidates it against current state, and applies it as a new working appointment version.

### 11.5 Finalization

Given every active participant confirms the same current appointment version, the system finalizes that version exactly once, transitions the activity to `scheduled`, and publishes the final appointment to both chat surfaces.

### 11.6 Confirmation invalidation

Given a finalized or partially confirmed appointment changes materially, the system creates a new version and invalidates affected confirmations. The changed appointment is not final until every active participant confirms the new version.

### 11.7 Agent restraint

Given participants exchange ordinary social messages in the group chat without a coordination request or conflict, Senior Quest does not reply.

### 11.8 Permission enforcement

Given a non-organizer requests cancellation or a roster change, the system makes no mutation and explains that the organizer must perform the action.

### 11.9 Privacy

Given a private constraint blocks a group request, neither the group response, change card, logs exposed to participants, nor notifications reveal whose constraint it was or its sensitive details.

## 12. Current implementation gaps

The present implementation already provides private participant threads, structured pending requirements, appointment versions, confirmation records, authorization checks, audit events, and quest-linked group conversation infrastructure. The following gaps must be closed:

- expose the quest group chat inside the coordination experience;
- connect group messages to the coordination agent and activity command pipeline;
- expand the agent output contract from `reply + requirementPatch` to structured coordination intents;
- replace the current manual “suggest arrangement” dependency with message-triggered compatibility evaluation and appointment mutation;
- allow authorized participant-driven time, venue, and duration changes;
- publish committed mutations and status changes into both chat surfaces;
- make confirmation possible through natural language in either chat;
- ensure appointment changes invalidate confirmations and finalization requires every active participant, including the organizer;
- add privacy-safe compromise generation when requests conflict; and
- make agent intervention selective in ordinary group conversation.

