import { useEffect, useRef, useState } from "react";
import { api, type Source } from "../api";
import { AnswerText } from "./AnswerText";
import { SourcePanel } from "./SourcePanel";

interface Turn {
  question: string;
  answer?: string;
  sources: Source[];
  steps: { label: string; detail: string }[];
  error?: string;
  pending: boolean;
}

const EXAMPLES = [
  "Quelles sont les obligations de vigilance envers la clientèle ?",
  "Comment identifier le bénéficiaire effectif d'une personne morale ?",
  "Quels documents faut-il fournir pour une demande d'agrément ?",
  "Dans quel délai une banque doit-elle traiter une réclamation ?",
];

export function Chat({ themes }: { themes: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [openSource, setOpenSource] = useState<Source | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = turns.some((t) => t.pending);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const update = (fn: (t: Turn) => Turn) =>
    setTurns((all) => all.map((t, i) => (i === all.length - 1 ? fn(t) : t)));

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setInput("");
    setOpenSource(null);
    setTurns((t) => [...t, { question, sources: [], steps: [], pending: true }]);
    let finished = false;
    try {
      await api.chat(question, conversationId, selectedThemes, (e) => {
        if (e.type === "start") setConversationId(e.conversation_id);
        if (e.type === "step") update((t) => ({ ...t, steps: [...t.steps, { label: e.label, detail: e.detail }] }));
        if (e.type === "answer") {
          finished = true;
          update((t) => ({ ...t, answer: e.answer, sources: e.sources, pending: false }));
        }
        if (e.type === "error") {
          finished = true;
          update((t) => ({ ...t, error: e.message, pending: false }));
        }
      });
    } catch (err) {
      finished = true;
      update((t) => ({ ...t, error: (err as Error).message, pending: false }));
    } finally {
      // Flux coupé sans réponse ni erreur (serveur redémarré, proxy…) : ne pas laisser un vide
      if (!finished) update((t) => ({ ...t, error: "La connexion a été interrompue avant la réponse. Réessayez." }));
      update((t) => ({ ...t, pending: false }));
    }
  }

  return (
    <div className={`chat ${openSource ? "with-panel" : ""}`}>
      <section className="thread">
        {turns.length === 0 && (
          <div className="empty">
            <h2>Posez une question sur la réglementation bancaire marocaine</h2>
            <p>Chaque réponse cite la circulaire, l'article et la page. Cliquez sur un numéro pour lire le passage.</p>
            <div className="examples">
              {EXAMPLES.map((q) => (
                <button key={q} onClick={() => ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <article key={i} className="turn">
            <div className="question">{t.question}</div>
            <div className="response">
              {t.pending && (
                <ol className="steps">
                  {t.steps.map((s, j) => (
                    <li key={j} title={s.detail}>
                      ✓ {s.label}
                    </li>
                  ))}
                  <li className="running">…</li>
                </ol>
              )}
              {t.error && <p className="error">{t.error}</p>}
              {t.answer && (
                <AnswerText
                  text={t.answer}
                  onCite={(n) => setOpenSource(t.sources.find((s) => s.number === n) ?? null)}
                />
              )}
              {t.sources.length > 0 && (
                <ul className="sources">
                  {t.sources.map((s) => (
                    <li key={s.chunk_id}>
                      <button onClick={() => setOpenSource(s)}>
                        <span className="badge">{s.number}</span> {s.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!t.pending && t.steps.length > 0 && (
                <details className="trace">
                  <summary>Étapes de l'agent ({t.steps.length})</summary>
                  <ol>
                    {t.steps.map((s, j) => (
                      <li key={j}>
                        {s.label} <code>{s.detail}</code>
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          </article>
        ))}
        <div ref={bottom} />
      </section>

      {openSource && <SourcePanel source={openSource} onClose={() => setOpenSource(null)} />}

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        {themes.length > 0 && (
          <select
            value={selectedThemes[0] ?? ""}
            onChange={(e) => setSelectedThemes(e.target.value ? [e.target.value] : [])}
            aria-label="Filtrer par thème"
          >
            <option value="">Tous les thèmes</option>
            {themes.map((t) => (
              <option key={t} value={t}>
                {t.length > 60 ? `${t.slice(0, 60)}…` : t}
              </option>
            ))}
          </select>
        )}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex. : Que prévoit la circulaire 5/W/2017 sur le bénéficiaire effectif ?"
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Envoyer
        </button>
        {turns.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => {
              setTurns([]);
              setConversationId(null);
              setOpenSource(null);
            }}
            disabled={busy}
          >
            Nouvelle conversation
          </button>
        )}
      </form>
    </div>
  );
}
