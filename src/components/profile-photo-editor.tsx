"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useAppState } from "@/components/app-state";
import { useUser } from "@/components/user-context";
import type { UserProfile } from "@/server/identity/types";

export function ProfilePhotoEditor() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { user, setUser } = useUser();
  const { showToast } = useAppState();

  async function upload(file?: File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast("Choose a photo smaller than 5 MB"); return; }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("photo", file);
      const response = await fetch("/api/profile/avatar", { method: "POST", body: form });
      const result = await response.json() as { user?: UserProfile; error?: string };
      if (!response.ok || !result.user) throw new Error(result.error ?? "Could not update your photo");
      setUser(result.user);
      showToast("Your profile photo has been updated");
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : "Could not update your photo");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="profile-photo-editor">
      <div className="profile-photo">
        <Image src={user.photoUrl ?? "/assets/profile-maria.jpg"} alt={user.fullName} fill priority sizes="110px" />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} aria-label="Change profile photo"><Icon name="camera" size={18} /></button>
        <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event.target.files?.[0])} />
      </div>
      <button className="profile-photo-link" type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "Optimizing photo…" : "Change profile photo"}</button>
      <small>Photos are resized and compressed to save storage.</small>
    </div>
  );
}
