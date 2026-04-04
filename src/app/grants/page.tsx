import { supabase } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function GrantsPage() {
  const { data: grants } = await supabase
    .from("grants")
    .select("id, title, agency, categories, application_deadline, deadline_date, est_amounts_text, status")
    .in("status", ["active", "forecasted"])
    .order("deadline_date", { ascending: true, nullsFirst: false });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <Link href="/" className="text-xl font-bold text-foreground hover:underline">GrantRadar</Link>
            <p className="text-xs text-muted-foreground">Free grant alerts for CA nonprofits</p>
          </div>
          <Link href="/" className="text-sm text-primary hover:underline">
            ← Sign up for alerts
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold mb-2">California State Grants</h2>
        <p className="text-muted-foreground mb-6">{grants?.length || 0} active grants from the CA Grants Portal</p>

        <div className="space-y-3">
          {(grants || []).map((grant) => {
            const isClosingSoon = grant.deadline_date && new Date(grant.deadline_date) <= new Date(Date.now() + 14 * 86400000);
            return (
              <Link
                key={grant.id}
                href={`/grants/${grant.id}`}
                className="block rounded-lg border bg-card p-4 hover:border-primary transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{grant.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {grant.agency || "Unknown Agency"} · {grant.application_deadline || "Ongoing"}
                      {grant.est_amounts_text ? ` · ${grant.est_amounts_text}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {(grant.categories || []).slice(0, 3).map((cat: string) => (
                        <span key={cat} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                          {cat}
                        </span>
                      ))}
                      {(grant.categories || []).length > 3 && (
                        <span className="text-xs text-muted-foreground">+{grant.categories.length - 3}</span>
                      )}
                    </div>
                  </div>
                  {isClosingSoon && (
                    <span className="shrink-0 text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                      Closing soon
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
