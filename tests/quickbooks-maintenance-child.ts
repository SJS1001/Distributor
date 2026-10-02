import { Application } from "../src/server/application.ts";
let app: Application;
process.on("message", (message: any) => {
  if (message.action === "init") {
    app = new Application(message.path, "CA");
    process.send?.({ ready: true });
    return;
  }
  if (message.action !== "go") return;
  try {
    process.send?.(app.providerCredentials.authorization.expireAttempts());
  } finally {
    app.close();
    process.disconnect();
  }
});
