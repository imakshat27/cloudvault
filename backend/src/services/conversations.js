import { db } from "../db/db.js";
// Historical answers must not expose excerpts from files whose access was revoked.
export async function visibleConversation(conversation, userId) {
  const allowed = new Set(
    (await db.listDocumentsForUser(userId)).map((d) => d.id),
  );
  return {
    ...conversation,
    messages: conversation.messages.map((m) =>
      m.sources?.some((s) => !allowed.has(s.documentId))
        ? {
            ...m,
            text: "This answer is unavailable because a source was deleted or your access changed.",
            sources: [],
          }
        : m,
    ),
  };
}
