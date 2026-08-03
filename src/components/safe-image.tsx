"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

type SafeImageProps = Omit<ImageProps, "src"> & {
  src: string;
  fallbackSrc?: string;
};

/** Keeps a stale/deleted provider avatar from rendering as a broken-image icon. */
export function SafeImage({ src, fallbackSrc = "/assets/profile-maria.jpg", ...props }: SafeImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedSrc = failedSrc === src ? fallbackSrc : src;
  const { alt, ...imageProps } = props;

  return <Image {...imageProps} alt={alt} src={resolvedSrc} onError={() => {
    if (resolvedSrc !== fallbackSrc) setFailedSrc(src);
  }} />;
}
