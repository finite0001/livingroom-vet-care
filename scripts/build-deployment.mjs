import { build, loadEnv } from "vite";
import { verifyDeploymentEnvironment } from "./deployment-environment.mjs";

// Private payment/document routes do not opt into browser telemetry.
// Vercel injects this setting even with automatic system-variable exposure off.
delete process.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG;

try {
  const configuration = verifyDeploymentEnvironment(
    process.env,
    loadEnv("production", process.cwd(), "VITE_"),
  );
  console.log(`Verified ${configuration.target} backend configuration. Contact intake ${configuration.contactEnabled ? "configured" : "disabled"}.`);
  await build({ mode: "production" });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Deployment build failed.");
  process.exitCode = 1;
}
