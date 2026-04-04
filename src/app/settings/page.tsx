import { supabase } from "@/lib/supabase";
import { SettingsForm } from "./settings-form";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <div className="p-8 text-center">Invalid settings link.</div>;
  }

  const { data: org } = await supabase
    .from("organizations")
    .select("name, categories, geography_keywords, unsubscribe_token")
    .eq("unsubscribe_token", token)
    .single();

  if (!org) {
    return <div className="p-8 text-center">Invalid or expired link.</div>;
  }

  return (
    <div className="max-w-lg mx-auto p-8">
      <h2 className="text-xl font-bold mb-4">Settings for {org.name}</h2>
      <SettingsForm
        token={token}
        initialCategories={org.categories}
        initialGeoKeywords={org.geography_keywords.join(", ")}
      />
    </div>
  );
}
