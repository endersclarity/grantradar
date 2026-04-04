import { supabase } from "@/lib/supabase";
import { UnsubscribeConfirm } from "./unsubscribe-confirm";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Invalid unsubscribe link</h2>
          <p className="text-muted-foreground">Check your email for a valid unsubscribe link.</p>
        </div>
      </div>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, subscription_status")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Link expired or invalid</h2>
          <p className="text-muted-foreground">Check your email for a fresh unsubscribe link.</p>
        </div>
      </div>
    );
  }

  if (org.subscription_status === "cancelled") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Already unsubscribed</h2>
          <p className="text-muted-foreground">{org.name} is already unsubscribed from GrantRadar.</p>
          <a href="/" className="text-primary hover:underline text-sm">Back to GrantRadar →</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <a href="/" className="text-xl font-bold text-foreground hover:underline">GrantRadar</a>
        </div>
      </header>
      <UnsubscribeConfirm token={token} orgName={org.name} />
    </div>
  );
}
