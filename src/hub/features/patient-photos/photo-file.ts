import { z } from "zod";
import {
  photoDigest,
  photoDimensions,
} from "../../../../supabase/functions/_shared/patient-photo-image.ts";
export async function normalizePhoto(
  file: File,
): Promise<{ file: File; sha256: string }> {
  const parsed = z.object({
    size: z.number().int().min(1).max(10 * 1024 * 1024),
    type: z.enum(["image/jpeg", "image/png"]),
  })
    .safeParse({ size: file.size, type: file.type });
  if (!parsed.success) {
    throw new Error("Choose a nonempty JPEG or PNG no larger than 10 MiB.");
  }
  const dimensions = photoDimensions(
    new Uint8Array(await file.arrayBuffer()),
    file.type,
  );
  if (
    dimensions.width < 1 || dimensions.height < 1 ||
    dimensions.width * dimensions.height > 40000000
  ) {
    throw new Error("Choose an image of at most 40 megapixels.");
  }
  // Decode with EXIF orientation, then strip metadata and bound the saved image size.
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing unavailable");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("Image processing unavailable")),
        "image/png",
      )
    );
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error("Processed photo is too large.");
    }
    return {
      file: new File([blob], "patient-photo.png", { type: "image/png" }),
      sha256: await photoDigest(new Uint8Array(await blob.arrayBuffer())),
    };
  } finally {
    bitmap.close();
  }
}
