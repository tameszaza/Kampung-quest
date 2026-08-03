import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { AppStateProvider } from "@/components/app-state";

export default function ApplicationLayout({ children }: { children: ReactNode }) {
  return (
    <AppStateProvider>
      <AppShell>{children}</AppShell>
    </AppStateProvider>
  );
}
