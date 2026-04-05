"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GRANT_CATEGORIES } from "@/lib/constants";

interface EinData {
  name: string;
  city: string;
  state: string;
  ntee_code: string;
  revenue: number | null;
  categories: string[];
  mission_keywords: string[];
  suggested_min_amount: number | null;
  geography: string | null;
}

export function SignupForm() {
  const [ein, setEin] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [geoKeywords, setGeoKeywords] = useState("");
  const [missionKeywords, setMissionKeywords] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "looking-up" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [einLooked, setEinLooked] = useState(false);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const lookupEin = async () => {
    if (!ein.replace(/[-\s]/g, "")) return;
    setStatus("looking-up");
    setErrorMsg("");

    const res = await fetch(`/api/lookup-ein?ein=${encodeURIComponent(ein)}`);
    if (res.ok) {
      const data: EinData = await res.json();
      setName(data.name || "");
      if (data.categories.length > 0) setSelectedCategories(data.categories);
      if (data.mission_keywords.length > 0) setMissionKeywords(data.mission_keywords.join(", "));
      if (data.geography) setGeoKeywords(data.geography);
      if (data.suggested_min_amount) setMinAmount(String(data.suggested_min_amount));
      setEinLooked(true);
      setStatus("idle");
    } else {
      const err = await res.json();
      setErrorMsg(err.error || "EIN not found");
      setStatus("idle");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        categories: selectedCategories,
        geography_keywords: geoKeywords,
        mission_keywords: missionKeywords,
        min_grant_amount: minAmount ? parseInt(minAmount, 10) : null,
      }),
    });

    if (res.ok) {
      setStatus("success");
    } else {
      const data = await res.json();
      setErrorMsg(data.error || "Something went wrong");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <Card className="max-w-lg mx-auto border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950">
        <CardContent className="p-8 text-center">
          <h3 className="text-xl font-bold text-emerald-800 dark:text-emerald-200">Check your email!</h3>
          <p className="mt-2 text-emerald-700 dark:text-emerald-300">
            We sent a verification link. Click it to start receiving your free weekly grant digest.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>Get your weekly grant digest</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* EIN Lookup */}
          <div className="space-y-2">
            <Label htmlFor="ein">EIN (auto-fills everything)</Label>
            <div className="flex gap-2">
              <Input
                id="ein"
                value={ein}
                onChange={(e) => setEin(e.target.value)}
                placeholder="12-3456789"
                className="h-11 flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={lookupEin}
                disabled={status === "looking-up" || !ein.replace(/[-\s]/g, "")}
                className="h-11 px-4 shrink-0"
              >
                {status === "looking-up" ? "Looking up..." : "Look up"}
              </Button>
            </div>
            {einLooked && (
              <p className="text-xs text-emerald-600 font-medium">
                Found! Review and adjust below, then add your email.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Don't know your EIN? Fill in the fields manually below.
            </p>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Organization Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="h-11" />
            </div>
            <div className="space-y-2">
              <Label>Grant Categories (select all that apply)</Label>
              <div className="flex flex-wrap gap-2">
                {GRANT_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`text-sm px-3 py-1.5 rounded-full border transition-colors min-h-[36px] ${
                      selectedCategories.includes(cat)
                        ? "bg-primary text-primary-foreground border-primary font-medium"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              {selectedCategories.length > 0 && (
                <p className="text-xs text-primary">{selectedCategories.length} selected</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="mission">Mission keywords (we'll prioritize grants mentioning these)</Label>
              <Input
                id="mission"
                value={missionKeywords}
                onChange={(e) => setMissionKeywords(e.target.value)}
                placeholder="e.g. historic preservation, cultural heritage, landmark"
                className="h-11"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="geo">Geography (optional)</Label>
                <Input
                  id="geo"
                  value={geoKeywords}
                  onChange={(e) => setGeoKeywords(e.target.value)}
                  placeholder="e.g. Nevada County"
                  className="h-11"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="minAmount">Min amount (optional)</Label>
                <select
                  id="minAmount"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  <option value="">All amounts</option>
                  <option value="5000">$5,000+</option>
                  <option value="10000">$10,000+</option>
                  <option value="25000">$25,000+</option>
                  <option value="50000">$50,000+</option>
                  <option value="100000">$100,000+</option>
                </select>
              </div>
            </div>
          </div>

          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          <Button type="submit" className="w-full h-12 text-base" disabled={status === "loading" || selectedCategories.length === 0}>
            {status === "loading" ? "Signing up..." : "Get Free Weekly Digest"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Free forever. No credit card required.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
