import { build, loadEnv } from "vite";
import {
  stripVercelSystemPublicEnv,
  verifyDeploymentEnvironment,
} from "./deployment-environment.mjs";

// Private payment/document routes do not opt into browser telemetry.
// Vercel injects VITE_VERCEL_* metadata even though the app does not use it.
stripVercelSystemPublicEnv(process.env);

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
