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
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>Grant Categories (select all that apply)</Label>
            <div className="grid grid-cols-2 gap-2">
              {GRANT_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                    selectedCategories.includes(cat)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border hover:bg-muted"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="geo">Geography Keywords (comma-separated, optional)</Label>
            <Input
              id="geo"
              value={geoKeywords}
              onChange={(e) => setGeoKeywords(e.target.value)}
              placeholder="e.g. Nevada County, Northern California, Statewide"
            />
            <p className="text-xs text-muted-foreground">
              We'll match grants mentioning these areas. Leave blank to get statewide grants only.
            </p>
          </div>
          {errorMsg && <p className="text-sm text-red-600">{errorMsg}</p>}
          <Button type="submit" className="w-full" disabled={status === "loading" || selectedCategories.length === 0}>
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
