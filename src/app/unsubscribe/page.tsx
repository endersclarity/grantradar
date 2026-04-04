import { supabase } from "@/lib/supabase";
import { UnsubscribeConfirm } from "./unsubscribe-confirm";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <div className="p-8 text-center">Invalid unsubscribe link.</div>;
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, subscription_status")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return <div className="p-8 text-center">Invalid or expired unsubscribe link.</div>;
  }

  if (org.subscription_status === "cancelled") {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Already unsubscribed</h2>
        <p className="text-muted-foreground mt-2">{org.name} is already unsubscribed from GrantRadar.</p>
      </div>
    );
  }

  return <UnsubscribeConfirm token={token} orgName={org.name} />;
}
