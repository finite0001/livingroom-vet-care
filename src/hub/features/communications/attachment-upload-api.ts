import type { AttachmentUploadTransport } from "./attachment-upload.ts";
export interface AttachmentUploadApiClient {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
  storage: {
    from(
      bucket: string,
    ): {
      upload(
        path: string,
        file: File,
        options: { contentType: string; upsert: false },
      ): PromiseLike<{ error: unknown }>;
    };
  };
  functions: {
    invoke(
      name: string,
      options: { body: { id: string } },
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
}
/** The authenticated browser client supplies credentials; callers never provide service keys. */
export function createAttachmentUploadTransport(
  client: AttachmentUploadApiClient,
  actorId: string,
  currentActor: () => string | null,
): AttachmentUploadTransport {
  const checkActor = () => {
    if (!actorId || currentActor() !== actorId) {
      throw new Error("Account changed. Reopen this upload after signing in.");
    }
  };
  return {
    reserve: async (args) => {
      checkActor();
      const { data, error } = await client.rpc(
        "prepare_conversation_attachment",
        args,
      );
      checkActor();
      if (error) throw error;
      return data;
    },
    upload: async (path, file) => {
      checkActor();
      const { error } = await client.storage.from(
        "conversation-attachment-uploads",
      ).upload(path, file, { contentType: file.type, upsert: false });
      checkActor();
      if (error) throw error;
    },
    verify: async (id) => {
      checkActor();
      const { data, error } = await client.functions.invoke(
        "verify-conversation-attachment",
        { body: { id } },
      );
      checkActor();
      if (error) throw error;
      return data;
    },
  };
}
