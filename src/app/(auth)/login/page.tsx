import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await currentUser()) redirect("/home");
  return <div className="auth-layout"><AuthBrand /><div className="auth-card"><AuthForm mode="login" /></div></div>;
}

