import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
try {
  const { app } = await createApp(loadConfig());
  await app.listen({
    host: process.env.HOST || "127.0.0.1",
    port: Number(process.env.PORT || 3000),
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().then(() => process.exit(0));
    });
} catch (error) {
  // Startup errors are configuration messages; source credentials are never logged.
  console.error(
    error instanceof Error ? error.message : "Could not start the calendar.",
  );
  process.exit(1);
}
