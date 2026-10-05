import React, { lazy, Suspense } from "react";

// Keep the workspace usable when a secondary page cannot be downloaded.
// Browsers cache failed module imports, so recovery needs an explicit reload.
export function deferredPage<Props extends object>(
  label: string,
  load: () => Promise<{ default: React.ComponentType<Props> }>,
) {
  const Page = lazy(() =>
    load().catch(() => ({
      default: function LoadFailure() {
        return (
          <section aria-label={`${label} loading`}>
            <p role="alert">
              Unable to load {label.toLowerCase()}. Reload the workspace to try
              again.
            </p>
            <button onClick={() => window.location.reload()}>
              Reload workspace
            </button>
          </section>
        );
      },
    })),
  );
  return function DeferredPage(props: Props) {
    return (
      <Suspense fallback={<p role="status">Loading {label.toLowerCase()}…</p>}>
        <Page {...props} />
      </Suspense>
    );
  };
}
