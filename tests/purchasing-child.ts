import { Application } from "../src/server/application.ts";
import type { Actor } from "../src/server/core.ts";
import type {
  OrderRequestDecisionInput,
  OrderRequestWithdrawInput,
  OrderRequestResubmitInput,
} from "../src/shared/purchasing.ts";
let app: Application;
let input: {
  path: string;
  actor: Actor;
  key: string;
  action: "decide" | "withdraw" | "resubmit";
  payload:
    | OrderRequestDecisionInput
    | OrderRequestWithdrawInput
    | OrderRequestResubmitInput;
};
process.on("message", (message: any) => {
  if (message.action === "init") {
    input = message.input;
    app = new Application(input.path, "CA");
    process.send?.({ ready: true });
    return;
  }
  try {
    const result =
      input.action === "decide"
        ? app.orders.decideReview(
            input.actor,
            input.key,
            input.payload as OrderRequestDecisionInput,
          )
        : input.action === "withdraw"
          ? app.orders.withdrawReview(
              input.actor,
              input.key,
              input.payload as OrderRequestWithdrawInput,
            )
          : app.orders.resubmitReview(
              input.actor,
              input.key,
              input.payload as OrderRequestResubmitInput,
            );
    process.send?.({ ok: true, result });
  } catch (error) {
    process.send?.({ ok: false, code: (error as { code: string }).code });
  } finally {
    app.close();
    process.disconnect();
  }
});
