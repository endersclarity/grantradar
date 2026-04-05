"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GRANT_CATEGORIES } from "@/lib/constants";

export function SignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [geoKeywords, setGeoKeywords] = useState("");
  const [missionKeywords, setMissionKeywords] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
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
            <Label htmlFor="geo">Geography Keywords (comma-separated, optional)</Label>
            <Input
              id="geo"
              value={geoKeywords}
              onChange={(e) => setGeoKeywords(e.target.value)}
              placeholder="e.g. Nevada County, Northern California, Statewide"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              We'll match grants mentioning these areas. Leave blank to get statewide grants only.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mission">What does your org do? (keywords that describe your mission)</Label>
            <Input
              id="mission"
              value={missionKeywords}
              onChange={(e) => setMissionKeywords(e.target.value)}
              placeholder="e.g. historic preservation, cultural heritage, landmark"
              className="h-11"
            />
            <p className="text-xs text-muted-foreground">
              We'll prioritize grants that mention these terms. The more specific, the better.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="minAmount">Minimum grant amount (optional)</Label>
            <select
              id="minAmount"
              value={minAmount}
              onChange={(e) => setMinAmount(e.target.value)}
              className="w-full h-11 rounded-lg border border-input bg-background px-3 text-sm"
            >
              <option value="">Show all amounts</option>
              <option value="5000">$5,000+</option>
              <option value="10000">$10,000+</option>
              <option value="25000">$25,000+</option>
              <option value="50000">$50,000+</option>
              <option value="100000">$100,000+</option>
            </select>
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
