import { fork } from "child_process";
import express, { NextFunction, Request, Response } from "express";
import * as Sentry from "@sentry/node";
import { arbitrum, base, mainnet, optimism } from "viem/chains";
import helmet from "helmet";

const port = process.env.PORT || 8080;
const app = express();

console.log("Starting Liquidator");
if (
  process.env.SENTRY_DSN0 !== undefined &&
  process.env.SENTRY_DSN1 !== undefined &&
  process.env.SENTRY_DSN2 !== undefined
) {
  console.log("Configuring Sentry");
  Sentry.init({
    dsn: `https://${process.env.SENTRY_DSN0}@${process.env.SENTRY_DSN1}.ingest.sentry.io/${process.env.SENTRY_DSN2}`,
    enabled:
      process.env.SENTRY_DSN0 !== undefined &&
      process.env.SENTRY_DSN1 !== undefined &&
      process.env.SENTRY_DSN2 !== undefined,
    integrations: [
      new Sentry.Integrations.Http({ tracing: true }),
      new Sentry.Integrations.Express({ app }),
    ],
    release: process.env.GIT_COMMIT_SHA || undefined,
    tracesSampleRate: 0.02,
  });
}

// Configure Middleware
app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.tracingHandler());
app.use(helmet());
app.disable("x-powered-by");
app.set("trust proxy", true);

const chains = [mainnet.id, optimism.id, arbitrum.id, base.id];

chains.forEach((chain) => {
  const child = fork("lib/example.js", ["--chain", chain.toFixed(0)], {});
  child.on("spawn", () => console.log(`Forked process for chain ${chain}`));
  child.on("error", (err) => Sentry.captureException(err, { tags: { chain } }));
  // TODO: handle errors and exits
});

app.get("/liquidator_readiness_check", (req, res) => {
  res.send("OK");
});

// Used after all other routes to catch any unhandled errors
app.use(Sentry.Handlers.errorHandler());
// Catch 404 and send our own error message (instead of the default Express one)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((_req: Request, res: Response, _next: NextFunction) => {
  res.status(404).send("Not found");
});
// Catch all other errors and sennd our own error message (instead of the default Express one)
app.use(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (_err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).send("Internal server error");
  }
);

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server is running on port ${port}`);
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down");
  shutdown();
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down");
  shutdown();
});
