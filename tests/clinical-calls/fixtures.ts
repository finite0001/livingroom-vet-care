export const page = (total = 1, offset = 0) => ({
  data: { callId: 700013, language: "en", callers: [{ type: "contact", id: null, localIdentifier: "speaker-1" }], segments: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({ start: offset + i === 0 ? 1e-7 : offset + i, end: offset + i === 0 ? 0.125 : offset + i + 1, caller: "speaker-1", text: offset + i === 0 ? "Owner: 🐕 historical sign 0; café. No treatment administered." : `Owner: historical sign ${offset + i}; no treatment administered.` })) },
  pagination: { limit: 100, offset, total },
});
