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
}: {
  token: string;
  initialCategories: string[];
  initialGeoKeywords: string;
}) {
  const [categories, setCategories] = useState<string[]>(initialCategories);
  const [geoKeywords, setGeoKeywords] = useState(initialGeoKeywords);
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
      body: JSON.stringify({ token, categories, geography_keywords: geoKeywords }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>Categories</Label>
        <div className="grid grid-cols-2 gap-2">
          {GRANT_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => toggleCategory(cat)}
              className={`text-left text-sm px-3 py-2 rounded-md border transition-colors ${
                categories.includes(cat)
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
        <Label htmlFor="geo">Geography Keywords</Label>
        <Input id="geo" value={geoKeywords} onChange={(e) => setGeoKeywords(e.target.value)} />
      </div>
      <Button type="submit" className="w-full">
        {saved ? "Saved!" : "Save Changes"}
      </Button>
    </form>
  );
}
