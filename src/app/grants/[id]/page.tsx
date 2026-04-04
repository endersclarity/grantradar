import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function GrantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { data: grant } = await supabase
    .from("grants")
    .select("*")
    .eq("id", id)
    .single();

  if (!grant) notFound();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-bold text-foreground hover:underline">GrantRadar</Link>
          <Link href="/grants" className="text-sm text-primary hover:underline">← All grants</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">{grant.title}</h1>
        <p className="text-muted-foreground mb-6">{grant.agency || "Unknown Agency"}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Deadline</p>
            <p className="font-medium">{grant.application_deadline || "Ongoing"}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Estimated Amount</p>
            <p className="font-medium">{grant.est_amounts_text || "Not specified"}</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium capitalize">{grant.status}</p>
          </div>
        </div>

        {grant.purpose && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Purpose</h2>
            <p className="text-muted-foreground text-sm">{grant.purpose}</p>
          </div>
        )}

        {grant.description && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Description</h2>
            <p className="text-muted-foreground text-sm whitespace-pre-line">{grant.description}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {grant.categories && grant.categories.length > 0 && (
            <div>
              <h2 className="font-bold mb-2">Categories</h2>
              <div className="flex flex-wrap gap-1">
                {grant.categories.map((cat: string) => (
                  <span key={cat} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{cat}</span>
                ))}
              </div>
            </div>
          )}
          {grant.applicant_types && grant.applicant_types.length > 0 && (
            <div>
              <h2 className="font-bold mb-2">Eligible Applicants</h2>
              <div className="flex flex-wrap gap-1">
                {grant.applicant_types.map((t: string) => (
                  <span key={t} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {grant.geography_text && (
          <div className="mb-6">
            <h2 className="font-bold mb-2">Geography</h2>
            <p className="text-muted-foreground text-sm">{grant.geography_text}</p>
          </div>
        )}

        {grant.grant_url && (
          <a
            href={grant.grant_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            View on CA Grants Portal →
          </a>
        )}

        <div className="mt-12 rounded-lg border bg-card p-6 text-center">
          <h3 className="font-bold mb-2">Get grants like this in your inbox every Monday</h3>
          <p className="text-sm text-muted-foreground mb-4">Free. Matched to your nonprofit's categories and geography.</p>
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Sign up free →
          </Link>
        </div>
      </main>
    </div>
  );
}
