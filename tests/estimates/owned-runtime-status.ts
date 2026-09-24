import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";

export interface OwnedRuntimeStatus {
  API_URL: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
}

/** Never include CLI output in errors: status contains private local test keys. */
export function parseOwnedRuntimeStatus(raw: string): OwnedRuntimeStatus {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch { throw new Error("Owned Supabase status returned invalid JSON; private output withheld."); }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Owned Supabase status must be an object; private output withheld.");
  const status = value as Record<string, unknown>;
  if (typeof status.API_URL !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(status.API_URL) ||
      typeof status.ANON_KEY !== "string" || !status.ANON_KEY ||
      typeof status.SERVICE_ROLE_KEY !== "string" || !status.SERVICE_ROLE_KEY)
    throw new Error("Owned Supabase status lacks localhost API credentials; private output withheld.");
  return { API_URL: status.API_URL, ANON_KEY: status.ANON_KEY, SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY };
}

function capture(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
  } catch (error) {
    const failure = error as { code?: unknown; status?: unknown; signal?: unknown };
    const reason = failure.code === "ETIMEDOUT" ? "timed out" :
      typeof failure.status === "number" ? `exited ${failure.status}` :
        typeof failure.signal === "string" ? `ended with ${failure.signal}` : "failed to execute";
    throw new Error(`Owned ${command} status discovery ${reason}; private output withheld.`);
  }
}

export function readOwnedRuntimeStatus(project: string): OwnedRuntimeStatus {
  const config = readFileSync(`${project}/supabase/config.toml`, "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([a-zA-Z0-9_-]+)"/m)?.[1];
  if (!projectId?.startsWith("lrv-prescription-")) throw new Error("Explicit owned prescription runtime required.");
  const inspected = JSON.parse(capture("docker", ["inspect", `supabase_db_${projectId}`]));
  const labels = inspected[0]?.Config?.Labels;
  if (labels?.["com.supabase.cli.project"] !== projectId ||
      typeof labels?.["com.supabase.cli.workdir"] !== "string" ||
      realpathSync(labels["com.supabase.cli.workdir"]) !== realpathSync(project))
    throw new Error("Owned Supabase runtime identity or workdir does not match.");
  return parseOwnedRuntimeStatus(capture("supabase", ["status", "--workdir", project, "--output", "json", "--agent", "no"]));
}
