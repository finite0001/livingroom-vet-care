import { z } from "zod";

export const decoderFormats = ["EAN13", "EAN8", "UPCA", "UPCE", "Code128", "Code39", "DataMatrix", "QRCode"] as const;
export const MAX_FRAME_PIXELS = 1280 * 960;
export const decoderFrameSchema = z.object({
  sequence: z.number().int().positive().max(2147483647),
  width: z.number().int().positive().max(1280),
  height: z.number().int().positive().max(960),
  data: z.instanceof(Uint8ClampedArray),
}).strict().refine((frame) => frame.width * frame.height <= MAX_FRAME_PIXELS && frame.data.length === frame.width * frame.height * 4,
  "A bounded complete camera frame is required");
export interface DecoderFrame extends z.infer<typeof decoderFrameSchema> {}
export const decodedSymbolSchema = z.object({
  text: z.string().max(4096),
  bytes: z.array(z.number().int().min(0).max(255)).max(4096),
  format: z.enum(decoderFormats),
  symbologyIdentifier: z.string().max(20),
}).strict();
export interface DecodedSymbol extends z.infer<typeof decodedSymbolSchema> {}
export const decoderReplySchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("decoded"), sequence: z.number().int().positive(), symbols: z.array(decodedSymbolSchema).max(4) }).strict(),
  z.object({ outcome: z.literal("failed"), sequence: z.number().int().nonnegative() }).strict(),
]);
export type DecoderReply = z.infer<typeof decoderReplySchema>;
