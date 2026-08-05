"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

export function PageHeader({
  title,
  back = false,
  backHref,
  right,
}: {
  title: string;
  back?: boolean;
  backHref?: string;
  right?: ReactNode;
}) {
  const router = useRouter();

  return (
    <header className="page-header">
      <div className="page-header-side">
        {back && backHref ? (
          <Link className="icon-button" href={backHref} aria-label="Go back">
            <Icon name="back" />
          </Link>
        ) : back ? (
          <button className="icon-button" type="button" onClick={() => router.back()} aria-label="Go back">
            <Icon name="back" />
          </button>
        ) : null}
      </div>
      <h1>{title}</h1>
      <div className="page-header-side page-header-right">{right}</div>
    </header>
  );
}
