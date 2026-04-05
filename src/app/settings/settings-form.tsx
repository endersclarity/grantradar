"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GRANT_CATEGORIES } from "@/lib/constants";

export function SettingsForm({
  token,
  initialCategories,
  initialGeoKeywords,
  initialMissionKeywords,
  initialMinAmount,
}: {
  token: string;
  initialCategories: string[];
  initialGeoKeywords: string;
  initialMissionKeywords: string;
  initialMinAmount: string;
}) {
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [geoKeywords, setGeoKeywords] = useState(initialGeoKeywords);
  const [missionKeywords, setMissionKeywords] = useState(initialMissionKeywords);
  const [minAmount, setMinAmount] = useState(initialMinAmount);
  const [saved, setSaved] = useState(false);

  const toggleCategory = (cat: string) => {
    setCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        categories,
        geography_keywords: geoKeywords,
        mission_keywords: missionKeywords,
        min_grant_amount: minAmount ? parseInt(minAmount, 10) : null,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="flex flex-wrap gap-2">
          {GRANT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                categories.includes(cat)
                  ? "bg-primary text-primary-foreground border-primary font-medium"
                  : "bg-background border-border hover:bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="geo">Geography Keywords</Label>
        <Input id="geo" value={geoKeywords} onChange={(e) => setGeoKeywords(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="mission">Mission Keywords</Label>
        <Input
          id="mission"
          value={missionKeywords}
          onChange={(e) => setMissionKeywords(e.target.value)}
          placeholder="e.g. historic preservation, cultural heritage"
        />
        <p className="text-xs text-muted-foreground">
          Grants mentioning these terms will be prioritized in your digest.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="minAmount">Minimum Grant Amount</Label>
        <select
          id="minAmount"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
          className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
        >
          <option value="">Show all amounts</option>
          <option value="5000">$5,000+</option>
          <option value="10000">$10,000+</option>
          <option value="25000">$25,000+</option>
          <option value="50000">$50,000+</option>
          <option value="100000">$100,000+</option>
        </select>
      </div>
      <Button type="submit" className="w-full" disabled={categories.length === 0}>
        {saved ? "Saved!" : categories.length === 0 ? "Select at least one category" : "Save Changes"}
      </Button>
    </form>
  );
}
