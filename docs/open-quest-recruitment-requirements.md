# Open quest recruitment requirements

## Purpose

Allow an organizer to create an understaffed quest and recruit people through **Activities → Suggested**. Recruiting quests are broadly discoverable, while hard eligibility still controls who may request to join.

This document records the product decisions agreed during the grilling session. It does not replace the broader event-coordination lifecycle.

## Agreed product decisions

1. A quest may be created before it has enough participants to reach its minimum viable group size.
2. An understaffed quest is never published automatically.
3. The organizer must explicitly choose **Create & recruit** before the quest becomes visible to potential applicants.
4. Recruiting quests appear in the existing personalized **Suggested** feed.
5. A recruiting quest is broadly visible to active, verified members unless a safety or access exclusion requires it to remain hidden.
6. A viewer who fails ordinary hard constraints sees privacy-safe red notices and cannot request to join until those constraints pass.
7. An eligible person may submit a request to join. Requesting does not immediately make that person a participant.
8. The organizer must approve a join request before the applicant is added to the roster.
9. The system must re-run eligibility checks when the organizer attempts to approve a request.
10. Applicant-facing quest information and eligibility notices must be privacy-safe.
11. Group sizing distinguishes the minimum viable size, recruitment target, maximum allowed size, and current approved-member count.

## Implementation policies

The following conservative defaults complete lifecycle branches that were not resolved during the grilling session:

- A rejected request is final for that quest publication; the applicant cannot reapply to the same recruiting quest.
- When an approval reaches the target, any surplus pending requests close as rejected so no request remains indefinitely pending.
- A viewer may persistently hide a recruiting suggestion from their own Suggested feed. Hiding is private to that viewer and does not cancel, delete, or change access to the quest.

## Definitions

- **Organizer:** The person who created the quest. The organizer counts toward every group-size value.
- **Approved member:** The organizer, a recommended or manually selected person accepted with the organizer's publication/roster confirmation, or an applicant whom the organizer has approved, provided they remain active in the roster.
- **Applicant:** An eligible person who has requested to join but has not yet been approved.
- **Minimum group size:** The smallest number of approved members needed for the quest to be viable.
- **Target group size:** The number of approved members the organizer wants to recruit. Recruitment remains open after reaching the minimum and closes when it reaches this target.
- **Maximum group size:** The hard upper limit that the quest may never exceed.
- **Recruiting quest:** A published quest accepting join requests because its approved-member count is below its target.

The following invariant must always hold:

```text
minimum group size <= target group size <= maximum group size
```

## Initial quest-creation flow

1. The system attempts normal synthesis and matchmaking using eligible participants.
2. If the proposed roster reaches the requested minimum, the existing complete-roster review flow may continue.
3. If the proposed roster does not reach the minimum but the quest itself can still be safely described, the system presents an understaffed quest preview to the organizer.
4. The preview clearly states the current approved-member count and the minimum, target, and maximum group sizes. Example: **2 joined · 3 needed · recruiting up to 4**.
5. The organizer may select **Create & recruit** to publish it or **Not now** to leave it unpublished.
6. Selecting **Create & recruit** records the organizer's publication consent, approves the people already shown in the proposed roster for recruitment counting, and places the quest into a recruiting lifecycle state.
7. An unpublished quest must not appear in another person's Suggested feed and must not accept join requests.

## Suggested-feed discovery and eligibility

A recruiting quest appears in Suggested for active, verified members even when ordinary hard checks do not currently pass. Those checks still gate the **Request to join** action and include:

- compatible availability;
- distance or location limits;
- language compatibility;
- accessibility and mobility constraints;
- compatible group-size limits;
- invitation or participation consent;
- no overlapping active commitment; and
- space below the quest's target and maximum group sizes.

An ordinary mismatch produces one or more privacy-safe notices based on the viewer's own profile, public quest facts, or the generic outcome of a group-level compatibility check. A group-level notice may name the category, such as language or travel compatibility, but must not identify another person or reveal anyone else's constraint value. For example, the notice may say that the viewer's availability does not include the provisional time or that the quest's travel range is not compatible with their profile. The request action remains disabled.

Safety and access exclusions remain visibility gates. A quest must stay hidden when the viewer has no active or verified participation profile, a relationship block applies, the quest is full or closed, or the current roster cannot be safely verified. The response must never reveal that a relationship block or another member's private constraint caused the exclusion. Organizers and selected roster members may still see a related recruiting quest for management or status, but it must not be presented to them as an application opportunity.

Eligible quests should be ranked using relevant soft signals such as needs, interests, offers, and overall compatibility. Ineligible but discoverable quests rank below eligible matches.

Eligibility must be evaluated when the feed is read and re-evaluated when a join request is approved. Passing the feed check does not guarantee later approval if the person's circumstances or quest state change.

## Privacy-safe quest presentation

Before approval, a viewer may see:

- quest title and description;
- general date or availability window;
- broad neighbourhood, but not an exact address;
- accessibility requirements;
- roles or contributions being sought;
- minimum, target, and maximum group sizes; and
- recruitment progress, such as **2 of 4 target places filled**.

Before approval, the viewer must not see:

- participant identities;
- participants' personal needs or private profile facts;
- exact venue or home address;
- private availability details; or
- private coordination messages.

The Suggested screen must not describe every item as safely matched because it may contain quests the viewer cannot currently join. Use neutral wording such as **Activities available for [name]**. Each ineligible card and detail view must clearly identify that the viewer is not currently eligible.

## Join-request flow

1. A viewer opens a recruiting quest. If all hard checks pass, they may select **Request to join**; otherwise the disabled action and eligibility notices explain what must change.
2. The system creates one durable pending join request for that viewer and quest.
3. Repeated submissions must not create duplicate active requests.
4. A pending request does not count toward current approved members, the minimum, or the target.
5. The organizer can view pending requests and approve or reject each request.
6. On approval, the system rechecks the applicant's eligibility and the quest's remaining capacity in one authoritative operation.
7. If the checks pass, the applicant is added to the roster and the approved-member count increases by one.
8. If the checks fail, approval is refused and the organizer receives an actionable explanation, such as changed availability, a new commitment, or the quest becoming full.
9. The quest must never exceed its maximum group size, including when organizers act on concurrent requests.

## Recruitment completion

- Reaching the minimum makes the quest viable but does not close recruitment.
- Recruitment closes when the approved-member count reaches the target group size.
- The maximum remains a hard limit even if the target later changes.
- A closed quest no longer appears as available in other users' Suggested feeds and no longer accepts new join requests.
- Current approved members must equal the authoritative roster count; pending requests are tracked separately.

## Required UI changes

### Organizer

- Show an understaffed preview when initial matchmaking cannot reach the minimum.
- Show current, minimum, target, and maximum group sizes.
- Provide **Create & recruit** and **Not now** actions.
- After publication, show recruiting status and pending join requests.
- Provide approve and reject actions for each pending request.
- Explain why an approval fails if revalidation no longer passes.

### Applicant

- Include broadly discoverable recruiting quests in **Activities → Suggested**.
- Show privacy-safe red notices when ordinary hard constraints fail.
- Disable **Request to join** while any ordinary hard constraint fails.
- Provide **Hide from Suggested** for third-party recruiting suggestions.
- Clearly label recruiting status and available progress.
- Provide a **Request to join** action on the detail view.
- Replace the action with an unambiguous pending state after submission.
- Remove or close the opportunity when the target is reached or the viewer becomes ineligible.

## State and data requirements

The authoritative model must distinguish:

- publication consent and publication timestamp;
- recruiting/open versus closed status;
- minimum, target, and maximum group sizes;
- current approved roster members; and
- durable join requests with at least pending, approved, and rejected outcomes.

Join-request approval must use authorization, optimistic concurrency or an equivalent atomic capacity check, deterministic eligibility validation, idempotency, and an audit event. Client state must not be authoritative for publication, requests, approvals, roster membership, or capacity.

## Acceptance criteria

1. Given an understaffed draft, it is invisible to other users until the organizer selects **Create & recruit**.
2. Given a published recruiting quest and an ordinary hard mismatch, the viewer receives it in Suggested with privacy-safe notices and cannot request to join.
3. Given a safety- or access-excluded viewer, the quest is absent from Suggested and cannot be opened directly.
4. Suggested cards and applicant details expose only the approved privacy-safe fields and never reveal another person's constraint or a relationship block.
5. Requesting to join creates a pending request and does not immediately change roster membership.
6. Only the organizer can approve or reject a request.
7. Approval revalidates eligibility and capacity against current state.
8. Two concurrent approvals cannot grow the roster beyond the maximum or target.
9. The organizer is included in all displayed and validated group counts.
10. Reaching the minimum leaves recruitment open when the target is higher.
11. Reaching the target closes recruitment and removes the quest from Suggested feeds.
12. No pre-approval response exposes participant identities, exact locations, private needs, private availability, or coordination messages.
13. Hiding a suggestion removes it only from that viewer's Suggested feed and does not affect another viewer or direct privacy-safe access.

## Deferred decisions

The grilling session intentionally did not decide:

- whether applicants may withdraw or edit a pending request;
- whether and when pending requests expire;
- whether the organizer may change minimum, target, or maximum sizes after publication;
- whether an approved applicant must separately confirm participation before counting toward the roster;
- notification channels and reminder timing;
- organizer cancellation and republication behavior; and
- moderation, reporting, rate-limit, and abuse-handling rules.

These decisions must be resolved before implementation and should not be inferred from this document.
