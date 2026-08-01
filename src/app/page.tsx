const stages = [
  "Personal memory",
  "Candidate retrieval",
  "Quest synthesis and matchmaking",
  "Constraint validation",
  "Safety review",
  "Event coordination",
];

export default function Home() {
  return (
    <main>
      <p>Kampung Quest API</p>
      <h1>Shared needs become shared quests.</h1>
      <p>
        A modular Next.js server for forming safe, useful small-group activities from
        neighbours&apos; needs, interests, abilities, and constraints.
      </p>
      <section className="card">
        <h2>Pipeline</h2>
        <ol>
          {stages.map((stage) => (
            <li key={stage}>{stage}</li>
          ))}
        </ol>
        <p>
          Start with <code>POST /api/v1/memories</code>, then propose a quest through
          <code> POST /api/v1/quests/propose/:candidateId</code>.
        </p>
      </section>
    </main>
  );
}
