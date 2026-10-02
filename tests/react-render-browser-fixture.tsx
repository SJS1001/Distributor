import React, { Suspense, startTransition, useState } from "react";
import { createRoot } from "react-dom/client";
import { useOrderQueue } from "../src/web/order-queue.tsx";
import { useClaimQueue } from "../src/web/claim-queue.tsx";
import { Modal } from "../src/web/modal.tsx";

// Test-only instrumentation observes that React attempted the suspended tree.
// It never decides whether a product request or dialog action is valid.
declare global {
  interface Window {
    renderFixture: { attempts: number };
  }
}
window.renderFixture = { attempts: 0 };
const never = new Promise<void>(() => {});
const initial = [{ id: "initial" }],
  changed = [{ id: "changed" }];
const query = new URLSearchParams(location.search);
const kind = query.get("kind"),
  change = query.get("change");
function Wait({ suspended }: { suspended: boolean }) {
  if (suspended) {
    window.renderFixture.attempts++;
    throw never;
  }
  return null;
}
function Order({ mode }: { mode: number }) {
  const queue = useOrderQueue(
    mode === 1 && change === "source" ? changed : initial,
    "initial-cursor",
    !(mode === 1 && change === "active"),
  );
  return (
    <>
      <p role="status" aria-label="Queue request">
        {queue.items.map((i) => i.id).join(",")} ·{" "}
        {queue.busy ? "busy" : "idle"}
      </p>
      <button onClick={() => void queue.load()}>Continue queue</button>
      <Wait suspended={mode === 1} />
    </>
  );
}
function Claim({ mode }: { mode: number }) {
  const queue = useClaimQueue(
    mode === 1 && change === "source" ? changed : initial,
    "initial-cursor",
    !(mode === 1 && change === "active"),
  );
  return (
    <>
      <p role="status" aria-label="Queue request">
        {queue.items.map((i) => i.id).join(",")} ·{" "}
        {queue.busy ? "busy" : "idle"}
      </p>
      <button onClick={() => void queue.load()}>Continue queue</button>
      <Wait suspended={mode === 1} />
    </>
  );
}
function Dialog({
  mode,
  closed,
}: {
  mode: number;
  closed: (value: string) => void;
}) {
  return (
    <>
      <Modal
        dialog={{
          title: "Review fixture",
          fields: [{ name: "reason", label: "Reason" }],
          perform: async () => {},
        }}
        busy={mode !== 0 && change === "busy"}
        error=""
        close={() =>
          closed(
            mode === 1 ? "uncommitted" : mode === 2 ? "committed" : "visible",
          )
        }
        submit={async () => {}}
      />
      <Wait suspended={mode === 1} />
    </>
  );
}
function Fixture() {
  const [mode, setMode] = useState(0),
    [closes, setCloses] = useState<string[]>([]);
  return (
    <>
      <button onClick={() => startTransition(() => setMode(1))}>
        Suspend update
      </button>
      <button onClick={() => setMode(0)}>Cancel update</button>
      <button onClick={() => setMode(2)}>Commit update</button>
      <output aria-label="Close actions">{closes.join(",") || "none"}</output>
      <Suspense fallback={<p>Suspended fallback</p>}>
        {kind === "order" ? (
          <Order mode={mode} />
        ) : kind === "claim" ? (
          <Claim mode={mode} />
        ) : (
          <Dialog
            mode={mode}
            closed={(value) => setCloses((old) => [...old, value])}
          />
        )}
      </Suspense>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>,
);
