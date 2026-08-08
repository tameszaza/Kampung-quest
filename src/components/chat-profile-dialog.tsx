"use client";

import Image from "next/image";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { isLocalAvatarUrl } from "@/lib/avatar-url";
import type { ChatProfile } from "@/server/identity/types";

export function ChatProfileDialog({ profile, onClose }: { profile: ChatProfile; onClose: () => void }) {
  return <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="create-sheet chat-profile-sheet" role="dialog" aria-modal="true" aria-labelledby="chat-profile-title">
      <button className="icon-button sheet-close" type="button" onClick={onClose} aria-label="Close profile"><Icon name="close" /></button>
      <div className="chat-profile-hero"><Avatar src={profile.photoUrl} name={profile.fullName} size={86} /><h2 id="chat-profile-title">{profile.fullName}</h2>{profile.username ? <p>@{profile.username}</p> : null}</div>
      <dl className="chat-profile-details">
        <div><dt>Full name</dt><dd>{profile.fullName}</dd></div>
        <div><dt>Email</dt><dd>{profile.email || "Not shared"}</dd></div>
        <div><dt>Phone</dt><dd>{profile.phone || "Not shared"}</dd></div>
      </dl>
      <section className="emergency-profile-card">
        <h3>Emergency contact</h3>
        {profile.emergencyContact ? <dl className="chat-profile-details"><div><dt>Name</dt><dd>{profile.emergencyContact.name}</dd></div><div><dt>Relationship</dt><dd>{profile.emergencyContact.relationship}</dd></div><div><dt>Phone</dt><dd>{profile.emergencyContact.phone}</dd></div>{profile.emergencyContact.email ? <div><dt>Email</dt><dd>{profile.emergencyContact.email}</dd></div> : null}</dl> : <p>No emergency contact added.</p>}
      </section>
    </section>
  </div>;
}

function Avatar({ src, name, size }: { src: string | null; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;
  return <span className="chat-avatar" style={{ width: size, height: size }}>{showImage ? <Image src={src!} alt="" fill sizes={`${size}px`} unoptimized={isLocalAvatarUrl(src)} onError={() => setFailed(true)} /> : <span aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>}</span>;
}
