import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { AppStateProvider } from "@/components/app-state";
import { UserProvider } from "@/components/user-context";
import { currentUser } from "@/server/identity/session";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (!user.onboardingComplete) redirect("/register/complete");
  return (
    <UserProvider initialUser={user}>
      <AppStateProvider>
        <AppShell>{children}</AppShell>
      </AppStateProvider>
    </UserProvider>
  );
}
