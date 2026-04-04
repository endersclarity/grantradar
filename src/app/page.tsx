import { SignupForm } from "@/components/signup-form";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold">GrantRadar</h1>
          <p className="text-muted-foreground">Grant deadline intelligence for California nonprofits</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold tracking-tight mb-4">
            Stop missing grants.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Every Monday, get a personalized email with CA state grants that match your
            nonprofit. Matched by category and geography. No login required.
          </p>
        </div>

        <SignupForm />

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div>
            <h3 className="font-semibold mb-2">160+ Active Grants</h3>
            <p className="text-sm text-muted-foreground">
              Synced daily from the CA Grants Portal. We watch so you don't have to.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Matched to You</h3>
            <p className="text-sm text-muted-foreground">
              Filtered by your categories and geography. Only see what's relevant.
            </p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">$49/mo</h3>
            <p className="text-sm text-muted-foreground">
              2 free digests to try. Cancel anytime. Cheaper than missing one grant.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
