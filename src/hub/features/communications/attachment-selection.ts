export interface SelectedConversationAttachment { id: string; file: File }
export function addConversationAttachments(existing: SelectedConversationAttachment[], incoming: File[]): SelectedConversationAttachment[] {
  const all = [...existing.map(item => item.file), ...incoming];
  if (all.length > 5) throw new Error("Choose up to five attachments per email.");
  let total = 0;
  for (const file of all) {
    if (!["application/pdf", "image/png", "image/jpeg"].includes(file.type)) throw new Error("Choose PDF, PNG, or JPEG files.");
    if (!file.size || file.size > 10485760) throw new Error("Each attachment must be between 1 byte and 10 MB.");
    if (!file.name.trim() || file.name !== file.name.trim() || file.name.length > 255 ||
      [...file.name].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || /[/\\]/.test(file.name))
      throw new Error("Choose a file with a valid name.");
    total += file.size;
  }
  if (total > 20971520) throw new Error("Choose attachments totaling no more than 20 MB.");
  return [...existing, ...incoming.map(file => ({ id: crypto.randomUUID(), file }))];
}
