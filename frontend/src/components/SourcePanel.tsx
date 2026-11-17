import { useEffect, useState } from "react";
import { api, type Chunk, type Source } from "../api";

// Le texte extrait du PDF garde les retours à la ligne de la mise en page (une ligne = une
// ligne du PDF). On recolle les lignes d'un même paragraphe pour l'affichage, sans toucher
// aux listes (« - », « • », « 1) », « a) ») ni aux titres d'articles.
const NEW_BLOCK = /^(?:[-•*]|\d+[.)°]|[a-z]\)|Article\b|ARTICLE\b|Chapitre\b|Section\b|Titre\b)/;

export function reflow(text: string): string {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      out.push("");
      continue;
    }
    const prev = out[out.length - 1];
    const prevEnds = prev !== undefined && /[.:;!?]$/.test(prev);
    if (prev && !prevEnds && !NEW_BLOCK.test(line)) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.join("\n");
}

// Panneau latéral : le passage exact cité, pour que l'utilisateur vérifie lui-même.
export function SourcePanel({ source, onClose }: { source: Source; onClose: () => void }) {
  const [chunk, setChunk] = useState<Chunk | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChunk(null);
    setError(null);
    api.chunk(source.chunk_id).then(setChunk).catch((e) => setError(String(e.message ?? e)));
  }, [source.chunk_id]);

  return (
    <aside className="source-panel" aria-label="Source citée">
      <header>
        <span className="badge">[{source.number}]</span>
        <h3>{source.label}</h3>
        <button className="ghost" onClick={onClose} aria-label="Fermer">
          ✕
        </button>
      </header>
      <p className="doc-title">{source.doc_title}</p>
      {chunk?.section_path && <p className="section">{chunk.section_path}</p>}
      {error && <p className="error">{error}</p>}
      <pre className="passage">{reflow(chunk ? chunk.content : source.excerpt)}</pre>
    </aside>
  );
}
