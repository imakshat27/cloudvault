import ReactMarkdown from "react-markdown";
import { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  ArrowUp,
  FileText,
  ArrowUpRight,
  Plus,
  Search,
  BookOpen,
  ListChecks,
  LoaderCircle,
} from "lucide-react";
import { api } from "../services/api";
export function Chat({ document: doc, onOpen, readyCount, compact = false }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bottom = useRef(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  async function send(text = input) {
    if (!text.trim() || busy) return;
    const question = text.trim();
    setInput("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: question }]);
    try {
      const result = await api.ask(
        question,
        6,
        doc?.id,
        messages
          .filter((m) => m.role === "user")
          .slice(-4)
          .map((m) => m.text),
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.answer,
          sources: result.sources,
          model: result.llmModel,
        },
      ]);
    } catch (e) {
      setError(e.message);
      setInput(question);
    } finally {
      setBusy(false);
    }
  }
  const suggestions = doc
    ? [
        ["Give me a quick summary", BookOpen],
        ["What are the key takeaways?", ListChecks],
        ["What questions does this raise?", Sparkles],
      ]
    : [
        ["Find a file about…", Search],
        ["Summarize my documents", BookOpen],
        ["Compare the main ideas", ListChecks],
      ];
  const available = doc ? doc.status === "ready" : readyCount > 0;
  return (
    <section
      className={`chat ${compact ? "compact" : ""}`}
      aria-label={doc ? "Chat with this document" : "Research chat"}
    >
      <header className="chat-header">
        <div>
          <Sparkles size={18} />
          <strong>{compact ? "Ask this document" : "Research chat"}</strong>
        </div>
        <button
          className="icon-button"
          aria-label="New conversation"
          disabled={busy || !messages.length}
          onClick={() => {
            setMessages([]);
            setError("");
          }}
        >
          <Plus size={19} />
        </button>
      </header>
      <div className="chat-scroll">
        {!messages.length ? (
          <div className="chat-welcome">
            <span className="sparkle-orbit">
              <Sparkles size={compact ? 25 : 32} />
            </span>
            <span className="eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</span>
            <h2>
              {compact ? (
                "Get to know this file."
              ) : (
                <>
                  Your files have answers.
                  <br />
                  Let’s ask better questions.
                </>
              )}
            </h2>
            <p>
              {doc
                ? "Summarize, uncover insights, or ask something specific. Answers stay grounded in this source."
                : "Find that document, connect ideas, or turn a pile of files into your next “aha” moment."}
            </p>
            <div className="chat-suggestions">
              {suggestions.map(([text, Icon]) => (
                <button
                  key={text}
                  disabled={!available || busy}
                  onClick={() => {
                    if (text.endsWith("…")) setInput("Find a file about ");
                    else send(text);
                  }}
                >
                  <Icon size={18} />
                  <span>{text}</span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {messages.map((m, i) => (
              <article key={i} className={`message ${m.role}`}>
                <span className="message-label">
                  {m.role === "user" ? (
                    "You"
                  ) : (
                    <>
                      <Sparkles size={15} />
                      CloudVault
                    </>
                  )}
                </span>
                <div className="message-text markdown">
                  {m.role === "user" ? (
                    m.text
                  ) : (
                    <ReactMarkdown
                      components={{
                        a: ({ href, children }) => {
                          const match = href?.match(/^#source-(\d+)$/);
                          const source =
                            match && m.sources?.[Number(match[1]) - 1];
                          return source ? (
                            <button
                              className="citation"
                              onClick={() => onOpen(source.documentId)}
                            >
                              {children}
                            </button>
                          ) : (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {m.text.replace(/\[(\d+)\](?!\()/g, "[$1](#source-$1)")}
                    </ReactMarkdown>
                  )}
                </div>
                {m.sources?.length > 0 && (
                  <div className="sources">
                    <span className="eyebrow">
                      SOURCES ·{" "}
                      {new Set(m.sources.map((s) => s.documentId)).size} FILES
                    </span>
                    {m.sources
                      .filter(
                        (s, i, a) =>
                          a.findIndex((x) => x.documentId === s.documentId) ===
                          i,
                      )
                      .map((s) => (
                        <button
                          key={s.documentId}
                          onClick={() => onOpen(s.documentId)}
                        >
                          <FileText size={17} />
                          <span>
                            {s.filename}
                            <small>{s.snippet}</small>
                          </span>
                          <ArrowUpRight size={16} />
                        </button>
                      ))}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {busy && (
          <div className="thinking" role="status">
            <LoaderCircle className="spin" size={17} /> Finding the right
            passages…
          </div>
        )}
        {error && (
          <p role="alert" className="error">
            {error} Try sending your question again.
          </p>
        )}
        <div ref={bottom} />
      </div>
      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <label
            className="sr-only"
            htmlFor={compact ? "doc-question" : "vault-question"}
          >
            Your question
          </label>
          <textarea
            id={compact ? "doc-question" : "vault-question"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              available
                ? doc
                  ? "Ask about this document…"
                  : "Ask anything about your files…"
                : "Upload and index a file to begin…"
            }
            disabled={!available}
            maxLength={8000}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-bottom">
            <span>
              <span className="status-dot" />
              {doc
                ? "1 source selected"
                : `${readyCount} indexed ${readyCount === 1 ? "source" : "sources"}`}
            </span>
            <button
              className="send-button"
              aria-label="Send question"
              disabled={!available || busy || !input.trim()}
            >
              <ArrowUp size={19} />
            </button>
          </div>
        </form>
        <p className="chat-footnote">
          Grounded in your files. Always check the sources.
        </p>
      </div>
    </section>
  );
}
