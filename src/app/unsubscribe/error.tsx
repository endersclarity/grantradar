"use client";

export default function UnsubscribeError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-md mx-auto p-8 text-center space-y-4">
      <h2 className="text-xl font-bold">Couldn't process unsubscribe</h2>
      <p className="text-muted-foreground">
        The unsubscribe link may be invalid or expired. Check your email for a fresh link.
      </p>
      <button
        onClick={reset}
        className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Try again
      </button>
    </div>
  );
}
