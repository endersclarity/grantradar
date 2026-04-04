"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function UnsubscribeConfirm({ token, orgName }: { token: string; orgName: string }) {
  const [status, setStatus] = useState<"confirm" | "loading" | "done">("confirm");

  const handleUnsubscribe = async () => {
    setStatus("loading");
    await fetch("/api/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setStatus("done");
  };

  if (status === "done") {
    return (
      <div className="p-8 text-center">
        <h2 className="text-xl font-bold">Unsubscribed</h2>
        <p className="text-muted-foreground mt-2">
          {orgName} has been unsubscribed from GrantRadar. You won't receive any more digests.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 text-center max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-2">Unsubscribe {orgName}?</h2>
      <p className="text-muted-foreground mb-6">
        You'll stop receiving weekly grant digests. You can re-subscribe anytime.
      </p>
      <Button onClick={handleUnsubscribe} disabled={status === "loading"} className="w-full">
        {status === "loading" ? "Unsubscribing..." : "Confirm Unsubscribe"}
      </Button>
    </div>
  );
}
