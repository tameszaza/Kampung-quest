"use client";

import { FormEvent, useState } from "react";

const stages = [
  {
    number: "01",
    title: "Share a signal",
    description: "A need, an interest, or something you can offer.",
  },
  {
    number: "02",
    title: "Find the fit",
    description: "The engine looks for complementary needs and abilities.",
  },
  {
    number: "03",
    title: "Make it safe",
    description: "Constraints, consent, and a human-readable plan come first.",
  },
  {
    number: "04",
    title: "Meet with purpose",
    description: "A small quest with a clear role for everyone involved.",
  },
];

const initialForm = {
  candidateId: "neighbour-001",
  need: "I would enjoy meeting neighbours for a relaxed, healthy lunch.",
  interests: "cooking, healthy eating",
  offers: "I can share a simple low-sodium recipe",
  start: "2026-08-03T11:00",
  end: "2026-08-03T14:00",
  indoorRequired: true,
};

type FormState = typeof initialForm;
type RequestState = "idle" | "loading" | "success" | "error";

interface QuestRunResponse {
  runId?: string;
  status?: string;
  proposal?: {
    quest?: {
      title?: string;
      description?: string;
      durationMinutes?: number;
      groupSize?: number;
    };
    proposedParticipants?: Array<{ candidateId: string; proposedRole: string }>;
  } | null;
  safety?: { status?: string; riskLevel?: string } | null;
}

export default function Home() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [quest, setQuest] = useState<QuestRunResponse | null>(null);

  function updateForm<Key extends keyof FormState>(key: Key, value: FormState[Key]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestState("loading");
    setErrorMessage("");
    setQuest(null);

    try {
      const memoryResponse = await fetch("/api/v1/memories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: form.candidateId.trim(),
          need: form.need.trim(),
          interests: splitList(form.interests),
          offers: splitList(form.offers),
          constraints: {
            availableWindows: [
              {
                start: new Date(form.start).toISOString(),
                end: new Date(form.end).toISOString(),
              },
            ],
            maximumDistanceM: 1000,
            minimumGroupSize: 2,
            maximumGroupSize: 4,
            indoorRequired: form.indoorRequired,
            stairsAllowed: false,
            languages: ["English"],
            verified: true,
            invitationConsent: true,
          },
          narrative: form.need.trim(),
        }),
      });

      if (!memoryResponse.ok) throw new Error(await readError(memoryResponse));

      const questResponse = await fetch(
        `/api/v1/quests/propose/${encodeURIComponent(form.candidateId.trim())}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": `demo-${form.candidateId.trim()}`,
          },
        },
      );

      if (!questResponse.ok) throw new Error(await readError(questResponse));
      setQuest((await questResponse.json()) as QuestRunResponse);
      setRequestState("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      setRequestState("error");
    }
  }

  return (
    <main className="site-shell">
      <nav className="site-nav" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="Kampung Quest home">
          <span className="brand-mark" aria-hidden="true">K</span>
          <span>Kampung Quest</span>
        </a>
        <div className="nav-links">
          <a href="#how-it-works">How it works</a>
          <a href="#start">Start a quest</a>
        </div>
        <a className="nav-status" href="#start">
          <span className="status-dot" aria-hidden="true" />
          Open for neighbours
        </a>
      </nav>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">Neighbour-led matchmaking</p>
          <h1>A little help, made mutual.</h1>
          <p className="hero-lede">
            Turn a need, an interest, or an offer into a small, safe activity with people nearby.
          </p>
          <div className="hero-actions">
            <a className="button button-primary" href="#start">Start a quest <span aria-hidden="true">↗</span></a>
            <a className="text-link" href="#how-it-works">See how it works <span aria-hidden="true">↓</span></a>
          </div>
          <div className="hero-note">
            <span className="avatar-stack" aria-hidden="true"><i>R</i><i>M</i><i>A</i></span>
            <span>Small groups. Clear roles. Room for real connection.</span>
          </div>
        </div>

        <div className="quest-visual" aria-label="A preview of a community quest">
          <div className="visual-kicker"><span className="live-dot" /> Live quest preview <span>08:42</span></div>
          <div className="visual-heading">
            <p>Shared lunch circle</p>
            <strong>Good food, better company.</strong>
          </div>
          <div className="connection-map" aria-hidden="true">
            <div className="map-line map-line-one" />
            <div className="map-line map-line-two" />
            <div className="map-node map-node-main"><span>Q</span></div>
            <div className="map-node map-node-a"><span>J</span></div>
            <div className="map-node map-node-b"><span>S</span></div>
            <div className="map-node map-node-c"><span>L</span></div>
          </div>
          <div className="visual-footer">
            <div><span className="footer-label">People matched</span><strong>3 neighbours</strong></div>
            <div><span className="footer-label">Shared time</span><strong>Mon · 11:30</strong></div>
          </div>
          <div className="visual-tag">Mutual benefit found <span aria-hidden="true">✓</span></div>
        </div>
      </section>

      <section className="signal-strip" aria-label="Kampung Quest principles">
        <div><span className="signal-number">01</span><strong>Need + ability</strong><span>Meet in the middle.</span></div>
        <div><span className="signal-number">02</span><strong>Consent first</strong><span>No surprise invitations.</span></div>
        <div><span className="signal-number">03</span><strong>Small by design</strong><span>Better conversations.</span></div>
      </section>

      <section className="how-section" id="how-it-works">
        <div className="section-heading">
          <p className="eyebrow">The simple version</p>
          <h2>From a quiet signal to a shared plan.</h2>
          <p>Behind every quest is a careful sequence that keeps the human part visible.</p>
        </div>
        <div className="stage-grid">
          {stages.map((stage) => (
            <article className="stage" key={stage.number}>
              <span className="stage-number">{stage.number}</span>
              <h3>{stage.title}</h3>
              <p>{stage.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="start-section" id="start">
        <div className="form-intro">
          <p className="eyebrow">Make the first move</p>
          <h2>What could become easier with a few neighbours?</h2>
          <p>
            Start with one honest sentence. We&apos;ll shape it into a possible quest, then check the practical details before anyone is invited.
          </p>
          <div className="privacy-note">
            <span aria-hidden="true">◎</span>
            <div><strong>Designed for dignity</strong><br />Only share what helps make a good match.</div>
          </div>
        </div>

        <form className="quest-form" onSubmit={handleSubmit}>
          <div className="form-header"><span>New quest signal</span><span>1 / 1</span></div>
          <label>
            Profile label
            <input
              required
              value={form.candidateId}
              onChange={(event) => updateForm("candidateId", event.target.value)}
              placeholder="e.g. neighbour-001"
            />
            <small>Use a nickname or reference code — no full name needed.</small>
          </label>
          <label>
            What would you like to make possible?
            <textarea
              required
              rows={3}
              value={form.need}
              onChange={(event) => updateForm("need", event.target.value)}
              placeholder="I would enjoy..."
            />
          </label>
          <div className="form-row">
            <label>
              Things you enjoy
              <input value={form.interests} onChange={(event) => updateForm("interests", event.target.value)} placeholder="gardening, tea" />
            </label>
            <label>
              Something you can offer
              <input value={form.offers} onChange={(event) => updateForm("offers", event.target.value)} placeholder="a recipe, a lift" />
            </label>
          </div>
          <div className="form-row">
            <label>
              Available from
              <input type="datetime-local" required value={form.start} onChange={(event) => updateForm("start", event.target.value)} />
            </label>
            <label>
              Available until
              <input type="datetime-local" required value={form.end} onChange={(event) => updateForm("end", event.target.value)} />
            </label>
          </div>
          <label className="check-row">
            <input type="checkbox" checked={form.indoorRequired} onChange={(event) => updateForm("indoorRequired", event.target.checked)} />
            <span>I prefer an indoor, step-free place</span>
          </label>
          <button className="button button-submit" disabled={requestState === "loading"} type="submit">
            {requestState === "loading" ? "Finding a thoughtful fit…" : "Find a possible quest"}
            <span aria-hidden="true">→</span>
          </button>
          {requestState === "error" && <p className="form-message form-error" role="alert">{errorMessage}</p>}
          {requestState === "success" && quest && <QuestResult quest={quest} />}
        </form>
      </section>

      <footer className="site-footer">
        <div className="brand"><span className="brand-mark" aria-hidden="true">K</span><span>Kampung Quest</span></div>
        <p>Small acts, thoughtfully matched.</p>
        <span className="footer-build">API demo · v0.1</span>
      </footer>
    </main>
  );
}

function QuestResult({ quest }: { quest: QuestRunResponse }) {
  const title = quest.proposal?.quest?.title ?? "A possible quest is taking shape";
  const description = quest.proposal?.quest?.description ?? "Your signal has been saved for careful matchmaking.";
  const status = quest.status === "awaiting_acceptance" ? "Ready for invitations" : "Needs a human look";

  return (
    <div className="form-result" role="status">
      <div className="result-icon" aria-hidden="true">✓</div>
      <div>
        <span className="result-label">{status}</span>
        <h3>{title}</h3>
        <p>{description}</p>
        <div className="result-meta">
          <span>{quest.proposal?.quest?.durationMinutes ?? 60} min</span>
          <span>{quest.proposal?.quest?.groupSize ?? 2} people</span>
          <span>{quest.safety?.riskLevel ?? "reviewed"} risk</span>
        </div>
      </div>
    </div>
  );
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

async function readError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}
