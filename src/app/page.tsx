import { SignupForm } from "@/components/signup-form";
import { supabaseServer as supabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function getGrantStats() {
  const { count: activeGrants } = await supabase
    .from("grants")
    .select("*", { count: "exact", head: true })
    .in("status", ["active", "forecasted"]);

  const { count: orgCount } = await supabase
    .from("organizations")
    .select("*", { count: "exact", head: true })
    .eq("email_verified", true);

  return { activeGrants: activeGrants || 0, orgCount: orgCount || 0 };
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; upgraded?: string }>;
}) {
  const params = await searchParams;
  const { activeGrants, orgCount } = await getGrantStats();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">GrantRadar</h1>
            <p className="text-xs text-muted-foreground">Free grant alerts for CA nonprofits</p>
          </div>
          <a href="/grants" className="text-sm text-primary hover:underline">
            Browse grants →
          </a>
        </div>
      </header>

      {/* Hero gradient */}
      <div className="bg-gradient-to-b from-primary/[0.04] via-primary/[0.02] to-transparent">
      <main className="max-w-4xl mx-auto px-4 py-16 relative">
        {/* Status banners */}
        {params.verified === "success" && (
          <div className="mb-8 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
            <p className="text-emerald-800 font-medium">Email verified! Your first grant digest arrives Monday.</p>
          </div>
        )}
        {params.verified === "already" && (
          <div className="mb-8 p-4 rounded-lg bg-blue-50 border border-blue-200 text-center">
            <p className="text-blue-800 font-medium">Your email is already verified. Digests arrive every Monday.</p>
          </div>
        )}
        {params.verified === "invalid" && (
          <div className="mb-8 p-4 rounded-lg bg-red-50 border border-red-200 text-center">
            <p className="text-red-800 font-medium">Verification link is invalid or expired. Please sign up again.</p>
          </div>
        )}
        {params.upgraded === "success" && (
          <div className="mb-8 p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-center">
            <p className="text-emerald-800 font-medium">Welcome to Pro! You now have AI fit scores and daily alerts.</p>
          </div>
        )}

        {/* Hero */}
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-normal tracking-tight mb-4 text-foreground text-balance font-[family-name:var(--font-heading)]">
            Know which grants are worth your time.
          </h2>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto leading-relaxed">
            Tell us what your nonprofit does. We'll score every CA state grant
            by how well it fits your mission and email you the best matches every Monday.
          </p>
        </div>

        {/* Social proof bar */}
        <div className="flex flex-wrap justify-center gap-6 mb-12 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
            {activeGrants} active grants tracked
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-primary"></span>
            Updated daily from CA Grants Portal
          </span>
          {orgCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-accent"></span>
              {orgCount} nonprofit{orgCount !== 1 ? "s" : ""} signed up
            </span>
          )}
        </div>

        {/* Signup form */}
        <SignupForm />
      </main>
      </div>

        {/* Digest preview */}
        <div className="max-w-4xl mx-auto px-4 py-16">
          <h3 className="text-center text-lg font-semibold mb-6">What your Monday email looks like</h3>
          <div className="max-w-lg mx-auto rounded-xl border bg-card p-6 shadow-sm">
            <div className="border-b pb-3 mb-3">
              <p className="font-bold text-sm">GrantRadar</p>
              <p className="text-xs text-muted-foreground">Your Nonprofit · Week of Apr 7, 2026 · 8 matching grants</p>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs font-bold text-amber-700 tracking-wide">CLOSING SOON</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded">
                  "cultural heritage" in purpose
                </span>
                <p className="text-sm font-medium mt-1">CA Arts Council: Arts & Cultural Organizations General Operating Relief</p>
                <p className="text-xs text-muted-foreground">62 days left, good runway · Up to $150,000</p>
              </div>
              <div className="border-t pt-3">
                <p className="text-xs font-bold text-primary tracking-wide">NEW THIS WEEK</p>
                <span className="inline-block mt-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-semibold rounded">
                  "historic preservation" in title
                </span>
                <p className="text-sm font-medium mt-1">Office of Historic Preservation: Heritage Fund Grant</p>
                <p className="text-xs text-muted-foreground">5mo left · Up to $750,000</p>
              </div>
              <div className="border-t pt-3 text-xs text-muted-foreground">
                + 3 more matching grants...
              </div>
            </div>
          </div>
        </div>

        {/* Feature comparison */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
          <div className="rounded-xl border bg-card p-6">
            <h3 className="font-bold mb-1">Free</h3>
            <p className="text-2xl font-bold mb-3">$0<span className="text-sm font-normal text-muted-foreground">/forever</span></p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> Weekly grant digest every Monday</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> Category + geography matching</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> All {activeGrants}+ CA state grants</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> Manage categories anytime</li>
            </ul>
          </div>
          <div className="rounded-xl border-2 border-primary bg-card p-6 relative">
            <span className="absolute -top-3 left-4 bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">COMING SOON</span>
            <h3 className="font-bold mb-1">Pro</h3>
            <p className="text-2xl font-bold mb-3">$19<span className="text-sm font-normal text-muted-foreground">/month</span></p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> Everything in Free</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> AI Fit Score (0-100) per grant</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> AI grant narrative drafts</li>
              <li className="flex items-start gap-2"><span className="text-primary mt-0.5 text-xs">&#9679;</span> Daily new-grant alerts</li>
            </ul>
          </div>
        </div>
    </div>
  );
}
