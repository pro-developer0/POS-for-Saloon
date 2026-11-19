import { redirect } from "next/navigation";
import { getUser } from "@/server/session";
import { LoginForm } from "@/components/auth-forms";
export const metadata = { title: "Sign in" };
export default async function Page() { if (await getUser()) redirect("/dashboard"); return <LoginForm />; }
