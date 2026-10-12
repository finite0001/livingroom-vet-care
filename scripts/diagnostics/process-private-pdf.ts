/** Operator-invoked only. No scheduler, policy activation, staff download or release. */
import { z } from "zod";
import { createPdfService } from "../../services/diagnostic-renderer/service.ts";
import { processDiagnosticPdf } from "../../services/diagnostic-renderer/processing.ts";
import { renderInSandbox } from "../../services/diagnostic-renderer/sandbox.ts";
import { revalidateInSandbox } from "../../services/diagnostic-renderer/revalidate.ts";
import { verifyTrustedProvenance } from "../../services/diagnostic-renderer/trusted.ts";
const config = z
  .object({
    url: z.string().url(),
    key: z.string().min(20),
    job_id: z.string().uuid(),
  })
  .strict()
  .parse({
    url: process.env.DIAGNOSTIC_PDF_BACKEND_URL,
    key: process.env.DIAGNOSTIC_PDF_SERVICE_KEY,
    job_id: process.argv[2],
  });
try {
  const result = await processDiagnosticPdf(
    createPdfService({ url: config.url, key: config.key }),
    {
      generate: renderInSandbox,
      validate: revalidateInSandbox,
      verifyProvenance: verifyTrustedProvenance,
    },
    { job_id: config.job_id },
  );
  // Never print the chart, PDF, service key, object path or raw provider exception.
  console.log(JSON.stringify({ state: result.state }));
} catch {
  console.error(
    "Private PDF processing did not complete; retry the same job to recover captured bytes.",
  );
  process.exitCode = 1;
}
