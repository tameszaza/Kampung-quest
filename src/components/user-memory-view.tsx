"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { useUser } from "@/components/user-context";
import { getUserMemory } from "@/features/assistant/client";
import type { MemoryCard } from "@/server/domain/schemas";

export function UserMemoryView() {
  const { user } = useUser();
  const [memory, setMemory] = useState<MemoryCard | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getUserMemory().then((value) => {
      if (active) setMemory(value);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load your memory");
    });
    return () => { active = false; };
  }, [user.id]);

  return (
    <div className="page-container narrow-page">
      <PageHeader title="What Senior Quest Remembers" back />
      {memory === undefined && !error ? <div className="connected-state" role="status">Loading what I remember…</div> : null}
      {error ? <div className="connected-state error" role="alert">{error}</div> : null}
      {memory === null ? <div className="connected-state empty"><span aria-hidden="true">♥</span><h2>Let&apos;s get to know you</h2><p>Tell Senior Quest what would feel helpful or enjoyable. You decide exactly what is remembered.</p><Link className="primary-button" href="/messages?assistant=1">Start a conversation</Link></div> : null}
      {memory ? <article className="memory-card-live">
        <span className="memory-ready"><Icon name="check" size={18} /> Ready for matching</span>
        <h2>{memory.profile.need}</h2>
        <section><h3>Things you enjoy</h3><div className="memory-tags">{memory.profile.interests.length ? memory.profile.interests.map((interest) => <span key={interest}>{interest}</span>) : <span>Not specified</span>}</div></section>
        <section><h3>What you can share</h3><div className="memory-tags">{memory.profile.offers.length ? memory.profile.offers.map((offer) => <span key={offer}>{offer}</span>) : <span>Happy to participate</span>}</div></section>
        <dl><div><dt>Group size</dt><dd>{memory.profile.constraints.minimumGroupSize}–{memory.profile.constraints.maximumGroupSize} people</dd></div><div><dt>Distance</dt><dd>Up to {memory.profile.constraints.maximumDistanceM / 1000} km</dd></div><div><dt>Access</dt><dd>{memory.profile.constraints.indoorRequired ? "Indoors" : "Indoor or outdoor"}; {memory.profile.constraints.stairsAllowed ? "stairs are okay" : "no stairs"}</dd></div><div><dt>Language</dt><dd>{memory.profile.constraints.languages.join(", ")}</dd></div></dl>
        <p className="memory-updated">Updated {new Date(memory.updatedAt).toLocaleString()}</p>
        <Link className="primary-button" href="/messages?assistant=1">Update with Senior Quest</Link>
      </article> : null}
    </div>
  );
}
