import { useMemo, useState } from "react";
import { handleAgentMessage } from "./agent";
import { demoCalendarEvent, demoUser } from "./mockData";
import { createInitialState, type MemoryState } from "./memoryStore";
import "./styles.css";

type ChatMessage = {
  role: "user" | "agent";
  text: string;
};

export function App() {
  const initialState = useMemo(() => createInitialState(demoUser, demoCalendarEvent), []);
  const [state, setState] = useState<MemoryState>(initialState);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "agent",
      text: "You have Photon Residency Dinner tonight from 7-11 PM. Want me to remember new people you meet there?"
    }
  ]);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const result = handleAgentMessage(state, trimmed);
    setState(result.state);
    setMessages((current) => [
      ...current,
      { role: "user", text: trimmed },
      { role: "agent", text: result.reply }
    ]);
    setInput("");
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Friendy demo</p>
        <h1>Relationship Memory Agent</h1>
        <p>
          Friendy watches approved event windows, asks before saving new people,
          and helps you refind them from vague context later.
        </p>
      </section>

      <section className="layout">
        <div className="panel chat-panel">
          <div className="panel-heading">
            <h2>Photon Agent</h2>
            <span>{state.sessions[0].status.replace("_", " ")}</span>
          </div>

          <div className="messages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
                {message.text}
              </div>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              sendMessage(input);
            }}
          >
            <label className="sr-only" htmlFor="friendy-message">
              Message Friendy
            </label>
            <input
              id="friendy-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder='Try "yes", "save Maya: played piano, AI recruiting founder", or "who played piano at dinner?"'
            />
            <button type="submit">Send</button>
          </form>
        </div>

        <aside className="side-stack">
          <section className="panel">
            <h2>Event Window</h2>
            <p className="strong">{demoCalendarEvent.title}</p>
            <p className="muted">7-11 PM, San Francisco</p>
            <p className="muted">Source: mocked calendar</p>
          </section>

          <section className="panel">
            <h2>Candidate Queue</h2>
            {state.candidates.length === 0 ? (
              <p className="muted">Approve the event window to load mocked contact deltas.</p>
            ) : (
              <ul className="clean-list">
                {state.candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <span>{candidate.displayName}</span>
                    <small>{candidate.status}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Saved Memories</h2>
            {state.memories.length === 0 ? (
              <p className="muted">No confirmed memories yet.</p>
            ) : (
              <ul className="clean-list">
                {state.memories.map((memory) => (
                  <li key={memory.id}>
                    <span>{memory.displayName}</span>
                    <small>{memory.contextNote}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </section>
    </main>
  );
}
