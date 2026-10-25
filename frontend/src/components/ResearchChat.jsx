import { useEffect, useState } from "react";
import { Plus, MessageSquare, Trash2, LoaderCircle } from "lucide-react";
import { api } from "../services/api";
import { Chat } from "./Chat";
import { Dialog } from "./Dialog";
export function ResearchChat({ readyCount, onOpen }) {
  const [threads, setThreads] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.listConversations();
        if (!alive) return;
        setThreads(r.conversations);
        if (r.conversations.length) {
          const detail = await api.getConversation(r.conversations[0].id);
          if (alive) setActive(detail.conversation);
        }
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function openThread(id) {
    setLoading(true);
    setError("");
    try {
      setActive((await api.getConversation(id)).conversation);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  async function saved(conversation) {
    setActive(conversation);
    try {
      setThreads((await api.listConversations()).conversations);
    } catch (e) {
      setError(`Chat saved, but history could not refresh: ${e.message}`);
    }
  }
  async function remove() {
    setLoading(true);
    setError("");
    try {
      await api.deleteConversation(deleting.id);
      setThreads((t) => t.filter((c) => c.id !== deleting.id));
      if (active?.id === deleting.id) setActive(null);
      setDeleting(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="research-workspace">
      <aside className="research-history" aria-label="Research chat history">
        <div className="history-heading">
          <strong>Recent chats</strong>
          <button
            className="icon-button"
            aria-label="Start a new research chat"
            disabled={busy || loading}
            onClick={() => {
              setActive(null);
              setError("");
            }}
          >
            <Plus size={18} />
          </button>
        </div>
        <p className="history-note">Saved privately to your account</p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading && (
          <p className="history-status" role="status">
            <LoaderCircle size={15} className="spin" /> Opening your chats…
          </p>
        )}
        {!loading && !threads.length && (
          <p className="history-note">
            Your conversations will appear here after you ask a question.
          </p>
        )}
        <ul className="history-list">
          {threads.map((c) => (
            <li key={c.id} className={active?.id === c.id ? "active" : ""}>
              <button
                className="history-open"
                disabled={busy || loading}
                aria-current={active?.id === c.id ? "page" : undefined}
                onClick={() => openThread(c.id)}
                title={c.title}
              >
                <MessageSquare size={15} />
                <span>
                  {c.title}
                  <small>
                    {new Date(c.updated_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}{" "}
                    · {Math.floor(c.message_count / 2)}{" "}
                    {c.message_count === 2 ? "reply" : "replies"}
                  </small>
                </span>
              </button>
              <button
                className="icon-button"
                disabled={busy || loading}
                aria-label={`Delete conversation: ${c.title}`}
                onClick={() => setDeleting(c)}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <Chat
        key={active?.id || "new"}
        readyCount={readyCount}
        onOpen={onOpen}
        initialConversation={active}
        onSaved={saved}
        onNew={() => setActive(null)}
        onBusyChange={setBusy}
        historyLoading={loading}
      />
      {deleting && (
        <Dialog
          title="Delete this conversation?"
          onClose={() => {
            if (!loading) setDeleting(null);
          }}
        >
          <p>
            This removes the saved messages and citations in “{deleting.title}”.
            Your files stay in your library.
          </p>
          <div className="dialog-actions">
            <button
              className="secondary"
              disabled={loading}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </button>
            <button className="primary" disabled={loading} onClick={remove}>
              {loading ? "Deleting…" : "Delete conversation"}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
