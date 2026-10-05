import { lazy, Suspense, type ComponentProps } from "react";
import type * as References from "./gree-reference.tsx";
const Editor = lazy(() =>
  import("./gree-reference.tsx").then((m) => ({
    default: m.ReferenceMappingEditor,
  })),
);
const Matches = lazy(() =>
  import("./gree-reference.tsx").then((m) => ({ default: m.ReferenceMatches })),
);
const Summary = lazy(() =>
  import("./gree-reference.tsx").then((m) => ({
    default: m.ReferenceRequestSummary,
  })),
);
export function ReferenceMappingEditor(
  props: ComponentProps<typeof References.ReferenceMappingEditor>,
) {
  return (
    <Suspense fallback={<p role="status">Loading manufacturer references…</p>}>
      <Editor {...props} />
    </Suspense>
  );
}
export function ReferenceMatches(
  props: ComponentProps<typeof References.ReferenceMatches>,
) {
  return (
    <Suspense fallback={<p role="status">Loading manufacturer references…</p>}>
      <Matches {...props} />
    </Suspense>
  );
}
export function ReferenceRequestSummary(
  props: ComponentProps<typeof References.ReferenceRequestSummary>,
) {
  return (
    <Suspense fallback={<p role="status">Loading requested equipment…</p>}>
      <Summary {...props} />
    </Suspense>
  );
}
