# Kampung Quest

Kampung Quest is a modular Next.js web server for turning seniors' needs, interests, offers and constraints into safe, mutually beneficial group activities. The implementation follows the pipeline described below and exposes it through versioned App Router API endpoints.

## Competition context

Kampung Quest was built for the **AI Agent / Skills Track** of the WorkBuddy hackathon, whose
challenge is **"Age Well"**. The project uses an AI-assisted, safety-aware workflow to help older
adults turn everyday needs and interests into meaningful activities with neighbours. In short,
the goal is to reduce isolation while preserving dignity, consent, accessibility and human choice.

The competition development deadline is **9 August 2026, 11:59 PM SGT**. The submission is expected
to include an online demo link or Skill ZIP, a skill demo video, and a project introduction deck
(PPT). The submission form, process and exact submission timing are to be announced by the
organisers.

Judging is weighted as follows:

- **30 points — Impact & Relevance:** how directly the project addresses the Age Well challenge.
- **40 points — Effective use of AI tools:** including autonomous planning, workflows and tool invocation.
- **30 points — Project Quality:** creativity, completeness, technical execution and polish.
- **5-point bonus:** share the project on Rednote, YouTube or X with
  `#CodeBuddy #WorkBuddy #Miora #TencentCloudHackathon`.

This repository is therefore both the Kampung Quest product codebase and the working source for
the competition demo, video and deck. The AI roles, deterministic safeguards and end-to-end
workflow described below are the main evidence for the AI-tool and project-quality criteria.

## Run with Docker

```bash
cp .env.example .env
docker compose up --build
```

The service will be available at:

- Landing page: `http://localhost:3000`
- Registration: `http://localhost:3000/register`
- Login: `http://localhost:3000/login`
- Direct and group messages: `http://localhost:3000/messages`
- Health check: `http://localhost:3000/health`

Stop it with `docker compose down`.

## Run locally

Node.js 22 or newer is required. The OpenAI Agents SDK used by the model-backed adapter requires Node 22.

```bash
npm install
npm run dev
```

Run the automated checks with:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## API workflow

Member-facing APIs require the signed, HttpOnly session cookie managed by Better Auth under
`/api/auth/*`. Candidate IDs for memories, recommendations and quests are bound to the
authenticated member on the server; a browser cannot read or mutate another member's data by
changing a URL or request body.

The Senior Quest frontend exposes a model-driven conversation at `/assistant`. The conversation
agent asks adaptive questions, while schema-driven controls capture exact availability,
accessibility and consent. Confirmed runs stream truthful memory, retrieval, synthesis,
validation and safety stages to the browser. The same server-backed conversation is embedded in
the authenticated Messages experience and resumes independently for each signed-in member.

For direct API use:

1. Start an AI conversation with `POST /api/v1/assistant/conversations`, append answers under its `/turns` route, then confirm it under `/confirm`; the legacy complete-brief endpoint remains available at `POST /api/v1/assistant/recommend`.
2. Inspect eligible matches with `GET /api/v1/candidates/{candidateId}/retrieve`.
3. Run synthesis, validation, safety review and coordination with `POST /api/v1/quests/propose/{candidateId}`.
4. List recommendations with `GET /api/v1/quests?candidateId={candidateId}`, read durable quest state with `GET /api/v1/quests/{questId}`, and submit demo coordination events to `POST /api/v1/quests/{questId}/events`.

Example profile:

```json
{
  "candidateId": "candidate_001",
  "narrative": "I would enjoy meeting neighbours over a healthy lunch and can teach a low-sodium recipe.",
  "need": "Wants companionship during a healthy lunch",
  "interests": ["cooking", "healthy eating"],
  "offers": ["can teach a low-sodium recipe"],
  "constraints": {
    "availableWindows": [
      {
        "start": "2026-08-03T11:00:00+08:00",
        "end": "2026-08-03T14:00:00+08:00"
      }
    ],
    "maximumDistanceM": 1000,
    "minimumGroupSize": 2,
    "maximumGroupSize": 4,
    "indoorRequired": true,
    "stairsAllowed": false,
    "languages": ["English"],
    "verified": true,
    "invitationConsent": true
  }
}
```

## Project structure

```text
src/
├── app/
│   ├── api/v1/                    Next.js API route handlers
│   ├── api/auth/                  Better Auth email/password and Google OAuth handlers
│   ├── api/profile/               Onboarding, unique names, and optimized avatar storage
│   ├── api/chat/                  Direct/group conversations and stored messages
│   ├── health/route.ts            Container health endpoint
│   ├── layout.tsx                 Root application layout
│   └── page.tsx                   Service landing page
└── server/
    ├── domain/schemas.ts          Zod validation and domain types
    ├── features/
    │   ├── memory-service.ts      Markdown memory-card creation
    │   ├── retrieval-service.ts   Filtering and multi-factor scoring
    │   ├── synthesis-service.ts   Quest and group synthesis boundary
    │   ├── validation-service.ts  Deterministic constraint enforcement
    │   ├── safety-service.ts      Contextual safety review
    │   ├── coordination-service.ts Invitation and event preparation
    │   └── quest-pipeline.ts      Ordered workflow orchestration
    ├── repositories/              Replaceable persistence adapters
    └── container.ts               Service dependency wiring
tests/                              Service and pipeline tests
Dockerfile                          Multi-stage, non-root production image
compose.yaml                        Local container deployment
```

## Member accounts and chat

Migrations `003_identity_and_chat.sql` and `004_better_auth_and_profiles.sql` add isolated
`auth`, `identity`, and `chat` schemas. Every member
has a database profile plus a dedicated preference row for language, interests, activity level,
group size, accessibility, text size, contrast and notifications. Better Auth owns credential
hashing, OAuth account linking, session expiry, cookie protection, and rate limiting; plaintext
passwords are never written to the database or application logs. Display names normalize to a
unique searchable username, so members can find one another when starting direct or group chat.

Profile photos are optional. Uploaded JPG, PNG, and WebP files are orientation-corrected, cropped
to a maximum 512×512 avatar, stripped of metadata, and stored as compressed WebP. The Docker
volume `kampung-uploads` keeps those optimized avatars across restarts.

Chat supports direct-message deduplication, named groups, membership authorization, persisted
history, unread state, search, and periodic refresh for new messages. Development without
`DATABASE_URL` uses the same store contract in memory; Docker and production use PostgreSQL.

### Google sign-in

Set `BETTER_AUTH_SECRET` to a random value of at least 32 characters, set `BETTER_AUTH_URL` to the
public origin, and configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. In Google Cloud, add
this authorized redirect URI for local development:

```text
http://localhost:3000/api/auth/callback/google
```

Add the equivalent HTTPS URI for production. A first Google sign-in opens the profile completion
screen with Google name, email, and photo prefilled. The name and photo remain editable; the
verified Google email is locked. Returning members go straight back into their existing account.

Route handlers call one `KampungQuestEngine` interface. The engine owns ordered orchestration while injected adapters provide PostgreSQL, embeddings and AI-agent runs. Docker uses PostgreSQL with pgvector so memory and quest state survive restarts. Tests and credential-free development can use deterministic in-memory adapters.

## Core engine storage

One PostgreSQL instance contains four logical schemas:

| Schema | Responsibility |
| --- | --- |
| `memory` | Authoritative conversation events, exact constraints, versioned Markdown, normalized facts and agent audit records |
| `retrieval` | Rebuildable need, interest and offer embeddings tied to an exact active memory version |
| `quest` | Quest runs, proposals, safety/validation results and immutable coordination events |
| `assistant` | AI conversation transcripts, authoritative brief drafts and replayable workflow events |

The Personal Memory Micro-Agent is invoked only when new information arrives. It receives the active Markdown snapshot, current soft facts, authoritative constraints and the new narrative. A new snapshot becomes active only after all three embeddings are stored. Failed model or embedding work remains recorded while the previous active memory stays usable.

Markdown is stored as versioned database text and can be exported as a `.md` file; container-local files are not authoritative. Structured constraints remain code-owned, and the vector index can be rebuilt from memory records.

## Agent provider

The application defaults to hosted Gemini and reports missing credentials or provider failures
without silently switching behavior. To use OpenAI-hosted model calls instead:

```bash
AGENT_PROVIDER=openai
OPENAI_API_KEY=your-server-side-key
```

Recommended defaults are `gpt-5.6-luna` for memory, `gpt-5.6-terra` for synthesis, safety and recovery, and `text-embedding-3-small` for 1536-dimensional vectors. All model names are configurable through environment variables. Model inputs use run-local participant aliases and omit names, contact details and precise addresses. Provider tracing is disabled; de-identified run metadata and token usage are stored locally.

Gemini is also supported through Google's OpenAI-compatible Chat Completions endpoint:

```bash
AGENT_PROVIDER=gemini
GEMINI_API_KEY=your-server-side-key
```

The defaults use `gemini-2.5-flash-lite` for memory, safety and recovery,
`gemini-2.5-flash` for quest synthesis, and `gemini-embedding-001` for retrieval.
The application explicitly requests 1536-dimensional Gemini embeddings to match the
PostgreSQL `vector(1536)` column. `GEMINI_BASE_URL` and every Gemini model name can be
overridden through the environment variables shown in `.env.example`. Keep all provider
keys server-side; do not expose them through `NEXT_PUBLIC_` variables.

Embeddings from different providers, endpoints or models are not comparable, even when they
have the same number of dimensions. Retrieval therefore records an embedding-space identifier
and only compares candidates in the initiating user's provider/endpoint/model space. After
changing embedding providers, update every user's memory again (or rebuild all derived
embeddings from the stored memory records) before expecting the full pool to match.

Agent roles do not hand control to one another. Application code invokes them in sequence, validates structured output with Zod, allows one synthesis correction, and remains the only code allowed to change participants, invitations or quest state.

## Guided assistant demo

The central action in the application opens `/assistant`. PostgreSQL owns the transcript and
extracted quest brief; the browser caches only the current conversation identifier for resume.
`DEMO_SEED_ENABLED=true` supplies twelve clearly labelled synthetic neighbours for authenticated
members. Test/smoke profiles are excluded from production retrieval. Disable demo seeding when
real participant profiles are available.

The application defaults to the hosted Gemini provider and fails visibly when its key or quota
is unavailable. `AGENT_PROVIDER=deterministic` is an explicit development/test double; it is
never selected as a provider-failure fallback.

## Coordination events

The demo event endpoint accepts:

```json
{
  "type": "participant_accepted",
  "candidateId": "candidate_001"
}
```

Supported event types are `participant_accepted`, `participant_declined`, `participant_timed_out`, `quest_completed` and `quest_cancelled`. Declines and timeouts can select one reserve, but the replacement is deterministically revalidated and safety-reviewed before invitation.

## Product and agent architecture

This is a cleaner architecture than separating quest creation and matchmaking into two independent agents.

The main change is:

> Merge the Quest Formation Agent and Matching Analyst Agent into one **Quest Synthesis and Matchmaking Agent**.

This agent receives a filtered candidate pool, reads the candidates’ needs, offers and constraints, then simultaneously:

1. Creates a quest that benefits the group
2. Chooses the most suitable subset of candidates
3. Assigns meaningful roles
4. Produces a proposed participant group

This matches the core concept of turning several isolated needs into one shared activity, rather than creating an activity first and hoping suitable participants exist. 

# Final architecture

```text
1. Personal Memory Micro-Agent
        ↓
2. Vector Candidate Retrieval Service
        ↓
3. Quest Synthesis and Matchmaking Agent
        ↓
4. Deterministic Constraint Validator
        ↓
5. Safety Guardian Agent
        ↓
6. Event Coordination and Recovery Agent
```

Only components 1, 3, 5 and 6 are AI-agent roles.

The vector search and constraint validator are normal backend services.

# 1. Personal Memory Micro-Agent

There is one logical micro-agent per senior, but it does not run continuously.

Its job is to convert new user information into:

* Human-readable Markdown memory
* Structured hard constraints
* Need embeddings
* Interest embeddings
* Offer and ability embeddings

## Example Markdown card

```markdown
---
memory_id: need_102_001
senior_id: senior_102
memory_type: active_need
status: active
confidence: 0.94
expires_at: 2026-08-05T23:59:59+08:00
---

# Current need

Wants companionship during lunch and would prefer a small group.

# Interests

- Cooking
- Healthy eating
- Sharing traditional recipes

# What the senior can contribute

- Can teach a simple low-sodium recipe
- Comfortable guiding a small cooking activity

# Preferences

- Prefers indoor activities
- Prefers groups of two to four people
- Prefers activities around lunchtime

# Additional context

The senior enjoyed a previous small cooking activity but disliked a large noisy event.
```

## Structured constraints

The same need should have exact database fields:

```json
{
  "available_from": "2026-08-03T11:00:00+08:00",
  "available_until": "2026-08-03T14:00:00+08:00",
  "maximum_distance_m": 1000,
  "minimum_group_size": 2,
  "maximum_group_size": 4,
  "indoor_required": true,
  "stairs_allowed": false,
  "dietary_requirements": ["low_sodium"],
  "languages": ["English"],
  "verified": true,
  "invitation_consent": true
}
```

The Markdown gives the AI context and nuance. The structured fields enforce exact constraints.

# 2. Vector Candidate Retrieval Service

This is not an AI agent.

It retrieves approximately 10 to 20 potentially compatible candidate cards before the expensive matchmaking model runs.

However, do not perform only one similarity search.

If you search only for similar needs, you may retrieve many people who need the same help but nobody who can provide it.

Use at least three retrieval directions.

## A. Need-to-need similarity

Find candidates with related goals:

```text
Initiating need:
Wants companionship during lunch

Related needs:
Wants a small social meal
Wants to learn healthy cooking
Wants to meet nearby seniors
```

## B. Need-to-offer complementarity

Find candidates whose abilities help satisfy the initiating need:

```text
Need:
Wants help learning QR payment

Offer:
Can teach smartphone and QR payment skills
```

## C. Interest similarity

Find people likely to enjoy the same activity:

```text
Cooking
Gardening
Walking
Local history
Digital learning
```

## Recommended retrieval procedure

```text
Create embedding from the initiating need
        ↓
Retrieve top 10 similar need vectors
        ↓
Retrieve top 10 complementary offer vectors
        ↓
Retrieve top 10 similar interest vectors
        ↓
Combine and remove duplicates
        ↓
Apply basic hard filters
        ↓
Keep the best 10 to 20 candidates
```

A candidate retrieval score could be:

[
R =
0.30N +
0.25C +
0.20I +
0.15S +
0.10H
]

Where:

* (N): need similarity
* (C): need-to-offer complementarity
* (I): interest similarity
* (S): social preference compatibility
* (H): previous interaction compatibility

## Filters before the AI agent

Before sending candidates to the model, remove anyone who is:

* The initiating senior
* Unverified
* Not accepting invitations
* Already committed to another quest
* Outside the permitted distance
* Completely unavailable within the broad time window
* Language-incompatible
* Blocked by a safety or relationship restriction
* Associated with an expired or fulfilled need card

This reduces token usage and prevents the model from considering invalid candidates.

# 3. Quest Synthesis and Matchmaking Agent

This becomes the central reasoning agent.

It answers two questions at the same time:

> What unified quest could address these people’s mutual needs?

> Which candidates should be proposed for that quest?

## Inputs

The agent receives:

### Initiating user

* Current need Markdown
* Relevant past memories
* Structured constraints
* Interests
* Skills and offers

### Candidate pool

For each of the 10 to 20 candidates:

* Anonymised candidate ID
* Short Markdown need summary
* Interests
* Offers and abilities
* Soft preferences
* Structured constraints
* Retrieval scores
* Previous group information, when relevant

### Shared system context

* Approved quest templates
* Available venue types
* Available reward categories
* Safety policies
* Maximum group size
* Maximum quest duration
* Public-location requirement

## Example input

```json
{
  "initiating_user": {
    "candidate_id": "candidate_001",
    "need": "Wants companionship during a healthy lunch.",
    "interests": ["cooking", "healthy eating"],
    "offers": ["can teach a low-sodium recipe"],
    "constraints": {
      "available_windows": ["2026-08-03T11:00:00+08:00/2026-08-03T14:00:00+08:00"],
      "maximum_distance_m": 1000,
      "maximum_group_size": 4,
      "indoor_required": true,
      "stairs_allowed": false
    }
  },
  "candidates": [
    {
      "candidate_id": "candidate_002",
      "need": "Wants to learn to prepare healthier meals.",
      "interests": ["food", "healthy living"],
      "offers": ["can assist with ingredient preparation"],
      "constraints": {
        "available_windows": ["2026-08-03T11:30:00+08:00/2026-08-03T14:00:00+08:00"],
        "maximum_distance_m": 1500,
        "maximum_group_size": 5,
        "indoor_required": false,
        "stairs_allowed": true
      },
      "scores": {
        "need_similarity": 0.79,
        "offer_complementarity": 0.86,
        "interest_similarity": 0.88
      }
    },
    {
      "candidate_id": "candidate_003",
      "need": "Wants a small social activity with limited walking.",
      "interests": ["food", "storytelling"],
      "offers": ["can organise a table and facilitate conversation"],
      "constraints": {
        "available_windows": ["2026-08-03T11:00:00+08:00/2026-08-03T13:00:00+08:00"],
        "maximum_distance_m": 800,
        "maximum_group_size": 4,
        "indoor_required": true,
        "stairs_allowed": false
      },
      "scores": {
        "need_similarity": 0.83,
        "offer_complementarity": 0.91,
        "interest_similarity": 0.71
      }
    }
  ],
  "approved_templates": [
    "healthy_kampung_lunch",
    "sheltered_garden",
    "market_kaki",
    "digital_buddy"
  ],
  "system_rules": {
    "minimum_group_size": 2,
    "maximum_group_size": 5,
    "maximum_duration_minutes": 120,
    "public_venue_required": true,
    "explicit_consent_required": true
  }
}
```

# What the agent should reason about

The agent should evaluate the group as a whole, not candidates independently.

It should determine:

* Which needs can be solved together
* Whether each person can contribute something
* Whether the proposed activity is meaningful
* Whether the interests overlap enough
* Whether the abilities are complementary
* Whether every selected person has a clear role
* Whether the group-size preferences are compatible
* Whether a shared time appears possible
* Whether mobility and venue requirements can coexist
* Whether the quest is practical within available venues
* Whether one participant is repeatedly being used only as a helper
* Whether some candidates should remain reserve participants

# Agent output

The output should be strictly structured.

```json
{
  "quest": {
    "title": "Healthy Kampung Lunch",
    "quest_type": "social_cooking",
    "shared_goal": "Create companionship, healthier eating and a sense of purpose through a small shared cooking activity.",
    "description": "Three seniors prepare and share a simple low-sodium lunch in an accessible community kitchen.",
    "needs_addressed": [
      "companionship",
      "healthy eating",
      "small-group social connection",
      "sense of contribution"
    ],
    "duration_minutes": 90,
    "group_size": 3,
    "venue_requirements": [
      "approved_public_location",
      "indoor",
      "no_stairs",
      "seating_available",
      "accessible_toilet",
      "community_kitchen"
    ],
    "proposed_time_window": {
      "start": "2026-08-03T11:30:00+08:00",
      "end": "2026-08-03T13:00:00+08:00"
    }
  },
  "proposed_participants": [
    {
      "candidate_id": "candidate_001",
      "proposed_role": "recipe_guide",
      "needs_addressed": ["companionship"],
      "contributions_used": ["can teach a low-sodium recipe"]
    },
    {
      "candidate_id": "candidate_002",
      "proposed_role": "ingredient_helper",
      "needs_addressed": ["learn healthier cooking"],
      "contributions_used": ["can assist with preparation"]
    },
    {
      "candidate_id": "candidate_003",
      "proposed_role": "table_host",
      "needs_addressed": ["small social activity"],
      "contributions_used": ["can organise the table and facilitate conversation"]
    }
  ],
  "reserve_candidates": [
    {
      "candidate_id": "candidate_007",
      "possible_role": "ingredient_helper",
      "reason": "Compatible interests and available during the proposed period."
    }
  ],
  "mutual_benefit_explanation": [
    "The recipe guide gains companionship and a meaningful teaching role.",
    "The ingredient helper learns healthier meal preparation.",
    "The table host participates in a small low-mobility social activity."
  ],
  "confidence": 0.88
}
```

# Important terminology

The output participants are not yet final participants.

They should be called:

```text
proposed_participants
```

They become final participants only after:

* Safety approval
* Invitation acceptance
* Explicit consent
* Exact schedule confirmation
* Venue feasibility confirmation

This distinction is important because the AI cannot commit a senior to an activity.

# 4. Deterministic Constraint Validator

After the Quest Synthesis and Matchmaking Agent returns its plan, normal backend code must validate it.

The validator checks every proposed participant against the quest.

## Validation examples

```text
Does the proposed time fall inside everyone’s availability?

Is the venue requirement compatible with every mobility constraint?

Does the group size satisfy every selected participant?

Is the activity compatible with dietary restrictions?

Does the proposed travel radius satisfy everyone?

Are all selected participants verified?

Are all need cards active?

Is anyone already booked?

Does the proposed role match the participant’s stated ability?

Is the venue public and approved?

Does the quest avoid peer-to-peer money?
```

Example validation output:

```json
{
  "valid": false,
  "errors": [
    {
      "candidate_id": "candidate_002",
      "field": "availability",
      "message": "Candidate is unavailable after 12:30 PM."
    }
  ]
}
```

If validation fails:

```text
First failure:
Return the errors to the agent for one correction call

Second failure:
Try the next reserve candidate or require human review
```

Do not let the model repeatedly regenerate plans without a limit.

# 5. Safety Guardian Agent

The Safety Guardian receives only a validated quest proposal.

It reviews:

* Participant verification
* Venue safety
* Sensitive-information exposure
* Unusual role assignments
* Requests involving money
* Home visits
* Potential coercion
* Distress signals
* Previous safety incidents
* Relationship restrictions
* Whether human approval is required

Example output:

```json
{
  "status": "approved",
  "risk_level": "low",
  "conditions": [
    "Do not share participant phone numbers.",
    "Use coordinator verification at completion.",
    "Ask for consent before sharing display names."
  ],
  "requires_human_review": false
}
```

The PDF explicitly requires verified participants and places, minimal consent, no peer-to-peer money and human escalation for unusual or unsafe circumstances. 

# 6. Event Coordination and Recovery Agent

After safety approval, the plan is handed to the Event Coordination Agent.

This agent does not redesign the group unless a real-world event requires it.

## Responsibilities

* Send invitations
* Collect acceptance and consent
* Calculate exact availability overlap
* Confirm or reserve the venue
* Send reminders
* Handle no-responses
* Handle cancellations
* Find replacements from reserve candidates
* React to weather changes
* Obtain consent for plan changes
* Verify completion
* Trigger rewards and feedback

The PDF’s agentic distinction is that the system forms the group, checks accessibility, finds a common time, handles cancellations and verifies participation rather than merely recommending an activity. 

## Coordinator input

```json
{
  "quest_id": "quest_390",
  "quest": {
    "title": "Healthy Kampung Lunch",
    "duration_minutes": 90,
    "venue_requirements": [
      "indoor",
      "accessible",
      "community_kitchen"
    ]
  },
  "proposed_participants": [
    {
      "senior_id": "senior_102",
      "role": "recipe_guide"
    },
    {
      "senior_id": "senior_211",
      "role": "ingredient_helper"
    },
    {
      "senior_id": "senior_304",
      "role": "table_host"
    }
  ],
  "reserve_candidates": [
    "senior_315",
    "senior_417"
  ],
  "safety_conditions": [
    "Do not share phone numbers.",
    "Completion requires coordinator verification."
  ]
}
```

# Complete pipeline

```text
Senior submits a need
        ↓
Personal Memory Micro-Agent creates:
- Markdown need card
- Structured constraints
- Need, interest and offer vectors
        ↓
Vector retrieval performs:
- Need similarity search
- Offer complementarity search
- Interest similarity search
        ↓
Candidate sets are combined and deduplicated
        ↓
Basic hard filters remove invalid candidates
        ↓
Top 10 to 20 candidates remain
        ↓
Quest Synthesis and Matchmaking Agent:
- Reads candidate Markdown
- Reads structured constraints
- Identifies mutual needs
- Designs one shared quest
- Selects a proposed group
- Assigns roles
- Saves reserve candidates
        ↓
Deterministic validator:
- Rechecks every exact constraint
- Validates time, distance, accessibility and rules
        ↓
Safety Guardian:
- Reviews people, place, consent and risks
        ↓
Event Coordination and Recovery Agent:
- Invites participants
- Collects consent
- Finalises schedule
- Reserves venue
- Monitors changes
- Replaces participants when needed
- Verifies completion
        ↓
Rewards and feedback
        ↓
Personal memories and vectors are updated
```

# Revised agent count

The hosted runtime defines five focused agent roles.

## 1. Senior Quest Conversation Agent

One shared model-driven guide invoked for each conversation turn. Conversation state remains
in PostgreSQL rather than in a long-running model process.

## 2. Personal Memory Micro-Agent

One logical instance per senior, invoked only when information changes.

## 3. Quest Synthesis and Matchmaking Agent

One temporary instance per new quest request.

This replaces the previously separate Quest Formation Agent and Matching Analyst Agent.

## 4. Safety Guardian Agent

One shared safety service across all quests.

## 5. Event Coordination and Recovery Agent

One temporary stateful agent per active quest.

Therefore:

```text
1 shared conversation model invoked per turn
+
1 shared memory model invoked per confirmed update
+
1 shared quest synthesis model invoked per request
+
1 shared safety guardian
+
Q event coordinators for Q active quests
```

The event coordinators should remain dormant between events.

# Recommended candidate count

Start with:

```text
Retrieve approximately 30 raw vector results
        ↓
Deduplicate and hard-filter
        ↓
Send 10 to 15 candidates to the AI agent
```

Ten to fifteen is usually more practical than twenty because:

* Lower token cost
* Less irrelevant context
* Easier model reasoning
* More consistent structured output
* Faster response

Use twenty only when the cards are very compact or when the first retrieval pool lacks sufficient role diversity.

Each candidate package should ideally remain under approximately 100 to 180 tokens.

# Key design rule

Use each data representation for a different purpose:

| Representation         | Purpose                                              |
| ---------------------- | ---------------------------------------------------- |
| Markdown memory        | Human meaning, needs, nuance and abilities           |
| Vector embeddings      | Candidate discovery                                  |
| Structured constraints | Exact eligibility and validation                     |
| LLM agent              | Quest synthesis, group selection and role assignment |
| Deterministic code     | Enforcement, scheduling and correctness              |
| Safety agent           | Contextual risk assessment                           |
| Coordination agent     | Real-world execution and adaptation                  |

This approach is more tangible, less expensive and easier to demonstrate than creating a quest before knowing which people are realistically available. It also gives the central agent enough information to design a quest around actual mutual needs and complementary contributions.
