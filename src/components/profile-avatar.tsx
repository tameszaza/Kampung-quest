"use client";

import Image from "next/image";
import { useState } from "react";
import { isLocalAvatarUrl } from "@/lib/avatar-url";

export function ProfileAvatar({ name, photoUrl, size = 40, className = "" }: {
  name: string;
  photoUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(photoUrl) && !failed;
  return <span className={`profile-avatar ${className}`} style={{ width: size, height: size }} aria-label={name}>
    {showImage ? <Image src={photoUrl!} alt="" fill sizes={`${size}px`} unoptimized={isLocalAvatarUrl(photoUrl)} onError={() => setFailed(true)} /> : <span aria-hidden="true">{name.trim().slice(0, 1).toUpperCase() || "?"}</span>}
  </span>;
}
