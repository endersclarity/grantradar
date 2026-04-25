import { supabaseServer as supabase } from "@/lib/supabase-server";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Invalid settings link</h2>
          <p className="text-muted-foreground">Check your email for a valid settings link.</p>
        </div>
      </div>
    );
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, categories, geography_keywords, mission_keywords, min_grant_amount, unsubscribe_token")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <h2 className="text-xl font-bold">Link expired or invalid</h2>
          <p className="text-muted-foreground">Check your email for a fresh settings link.</p>
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
      <div className="max-w-lg mx-auto p-8">
        <h2 className="text-xl font-bold mb-4">Settings for {org.name}</h2>
        <SettingsForm
          token={token}
          initialCategories={org.categories || []}
          initialGeoKeywords={(org.geography_keywords || []).join(", ")}
          initialMissionKeywords={(org.mission_keywords || []).join(", ")}
          initialMinAmount={org.min_grant_amount ? String(org.min_grant_amount) : ""}
        />
      </div>
    </div>
  );
}
