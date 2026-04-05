import { supabase } from "@/lib/supabase";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page || "1", 10) || 1);
  const categoryFilter = params.category || "";

  let query = supabase
    .from("grants")
    .select("id, title, agency, categories, application_deadline, deadline_date, est_amounts_text, status, source", { count: "exact" })
    .in("status", ["active", "forecasted"])
    .order("deadline_date", { ascending: true, nullsFirst: false });

  if (categoryFilter) {
    query = query.contains("categories", [categoryFilter]);
  }

  const { data: grants, count } = await query
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const totalCount = count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  function pageUrl(p: number) {
    const parts = [`page=${p}`];
    if (categoryFilter) parts.push(`category=${encodeURIComponent(categoryFilter)}`);
    return `/grants?${parts.join("&")}`;
  }

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
        <p className="text-muted-foreground mb-6">
          {totalCount} active grants from CA state + federal sources
          {categoryFilter ? ` in ${categoryFilter}` : ""}
        </p>

        {categoryFilter && (
          <Link href="/grants" className="inline-block mb-4 text-xs text-primary hover:underline">
            Clear filter ×
          </Link>
        )}

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
                      {grant.agency || "Unknown Agency"} · {grant.deadline_date
                        ? new Date(grant.deadline_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "Ongoing"}
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {grant.source === "grants_gov" && (
                      <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                        Federal
                      </span>
                    )}
                    {grant.source === "ca_portal" && (
                      <span className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                        CA State
                      </span>
                    )}
                    {isClosingSoon && (
                      <span className="text-xs bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-medium">
                        Closing soon
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-8">
            {page > 1 && (
              <Link href={pageUrl(page - 1)} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-secondary">
                ← Prev
              </Link>
            )}
            <span className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            {page < totalPages && (
              <Link href={pageUrl(page + 1)} className="px-3 py-1.5 text-sm rounded-lg border hover:bg-secondary">
                Next →
              </Link>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
