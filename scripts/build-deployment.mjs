import { build, loadEnv } from "vite";
import { verifyDeploymentEnvironment } from "./deployment-environment.mjs";

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
