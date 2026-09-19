export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const documentCategories = [
  "medical_record",
  "lab_result",
  "consent",
  "anesthesia",
  "dental",
  "other",
] as const;
export function matchesDocumentSignature(
  bytes: Uint8Array,
  mime: string,
): boolean {
  if (mime === "application/pdf")
    return [37, 80, 68, 70, 45].every((value, index) => bytes[index] === value);
  if (mime === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  if (mime === "image/jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return false;
}
export async function validateDocumentFile(file: File): Promise<void> {
  if (!file.size || file.size > MAX_DOCUMENT_BYTES)
    throw new Error("Choose a nonempty file no larger than 20 MiB.");
  if (
    !matchesDocumentSignature(
      new Uint8Array(await file.slice(0, 8).arrayBuffer()),
      file.type,
    )
  )
    throw new Error(
      "Choose a PDF, JPEG or PNG whose contents match its file type.",
    );
}
