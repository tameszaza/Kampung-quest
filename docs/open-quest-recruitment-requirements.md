# Open quest recruitment requirements

## Purpose

Allow an organizer to create an understaffed quest and recruit eligible people through **Activities → Suggested**. Eligible people may request to join; the organizer decides whether to add them to the roster.

This document records the product decisions agreed during the grilling session. It does not replace the broader event-coordination lifecycle.

## Agreed product decisions

1. A quest may be created before it has enough participants to reach its minimum viable group size.
2. An understaffed quest is never published automatically.
3. The organizer must explicitly choose **Create & recruit** before the quest becomes visible to potential applicants.
4. Recruiting quests appear in the existing personalized **Suggested** feed.
5. A recruiting quest is visible only to people who currently pass its hard eligibility checks.
6. An eligible person may submit a request to join. Requesting does not immediately make that person a participant.
7. The organizer must approve a join request before the applicant is added to the roster.
8. The system must re-run eligibility checks when the organizer attempts to approve a request.
9. Applicant-facing quest information must be privacy-safe.
10. Group sizing distinguishes the minimum viable size, recruitment target, maximum allowed size, and current approved-member count.

## Implementation policies

The following conservative defaults complete lifecycle branches that were not resolved during the grilling session:

- A rejected request is final for that quest publication; the applicant cannot reapply to the same recruiting quest.
- When an approval reaches the target, any surplus pending requests close as rejected so no request remains indefinitely pending.

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

## Suggested-feed eligibility

A recruiting quest appears in a person's Suggested feed only when that person passes all applicable hard checks, including:

- compatible availability;
- distance or location limits;
- language compatibility;
- accessibility and mobility constraints;
- compatible group-size limits;
- verified and active profile or memory status;
- invitation or participation consent;
- no relationship block;
- no overlapping active commitment; and
- space below the quest's target and maximum group sizes.

Hard eligibility is a gate, not merely a ranking signal. After filtering, eligible quests should be ranked using relevant soft signals such as needs, interests, offers, and overall compatibility.

Eligibility must be evaluated when the feed is read and re-evaluated when a join request is approved. Passing the feed check does not guarantee later approval if the person's circumstances or quest state change.

## Privacy-safe quest presentation

Before approval, an eligible viewer may see:

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

The Suggested screen may continue to describe its contents as **Safely matched for [name]**, because every displayed recruiting quest has passed the viewer's hard eligibility checks.

## Join-request flow

1. An eligible viewer opens a recruiting quest and selects **Request to join**.
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

- Include eligible recruiting quests in **Activities → Suggested**.
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
2. Given a published recruiting quest, an ineligible user never receives it in their Suggested results.
3. Given an eligible user, the Suggested card exposes only the approved privacy-safe fields.
4. Requesting to join creates a pending request and does not immediately change roster membership.
5. Only the organizer can approve or reject a request.
6. Approval revalidates eligibility and capacity against current state.
7. Two concurrent approvals cannot grow the roster beyond the maximum or target.
8. The organizer is included in all displayed and validated group counts.
9. Reaching the minimum leaves recruitment open when the target is higher.
10. Reaching the target closes recruitment and removes the quest from eligible Suggested feeds.
11. No pre-approval response exposes participant identities, exact locations, private needs, private availability, or coordination messages.

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
