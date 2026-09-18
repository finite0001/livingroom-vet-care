import { createEstimatePublicationHandler } from "../_shared/estimate-publication-http.ts";
import { estimatePublicationRuntime } from "../_shared/estimate-publication-runtime.ts";
Deno.serve(createEstimatePublicationHandler(estimatePublicationRuntime(), "read"));
