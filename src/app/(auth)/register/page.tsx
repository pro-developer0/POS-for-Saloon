import { redirect } from "next/navigation";
import { getUser } from "@/server/session";
import { RegisterForm } from "@/components/auth-forms";
export const metadata = { title: "Create your business" };
export default async function Page() { if (await getUser()) redirect("/dashboard"); return <RegisterForm />; }
