"use client";

import Image, { type ImageProps } from "next/image";
import type { ComponentProps } from "react";
import { isLocalAvatarUrl } from "@/lib/avatar-url";

type AvatarImageProps = Omit<ImageProps, "src" | "fill"> & {
  src: string;
  onError?: ComponentProps<"img">["onError"];
};

/** Local avatar files must bypass Next's optimizer, which cannot decode a JSON 404. */
export function AvatarImage({ src, onError, ...props }: AvatarImageProps) {
  const className = `avatar-image${props.className ? ` ${props.className}` : ""}`;
  if (isLocalAvatarUrl(src)) {
    return <img {...props} className={className} src={src} alt={props.alt ?? ""} onError={onError} />;
  }
  return <Image {...props} className={className} src={src} fill alt={props.alt ?? ""} onError={onError} />;
}
