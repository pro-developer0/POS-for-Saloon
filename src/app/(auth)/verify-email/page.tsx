import { VerifyForm } from "@/components/auth-forms";
export const metadata = { title: "Confirm email" };
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) { return <VerifyForm token={(await searchParams).token ?? ""} />; }
