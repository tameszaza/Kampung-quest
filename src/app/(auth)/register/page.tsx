import { redirect } from "next/navigation";
import { AuthBrand } from "@/components/auth-brand";
import { AuthForm } from "@/components/auth-form";
import { currentUser } from "@/server/identity/session";

export const metadata = { title: "Create account" };

export default async function RegisterPage() {
  if (await currentUser()) redirect("/home");
  return <div className="auth-layout register-layout"><AuthBrand compact /><div className="auth-card"><AuthForm mode="register" /></div></div>;
}

