import type { PrescriptionDraftFields } from "./PrescriptionEditor";
export function emptyPrescriptionDraft(): PrescriptionDraftFields {
  return { medicationName: "", strength: "", form: "", directions: "", route: "", quantity: "", stockUnit: "", refills: "", startsOn: "", expiresOn: "", fulfillmentMode: "", productId: "", encounterId: "" };
}
