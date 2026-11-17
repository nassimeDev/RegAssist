import { Fragment, type ReactNode } from "react";

// Mini-rendu Markdown (gras, listes, paragraphes) + citations [n] cliquables.
// Volontairement simple : pas de HTML injecté, donc pas de risque XSS.

function inline(text: string, onCite: (n: number) => void, key: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/g);
  return parts.map((p, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={k}>{p.slice(2, -2)}</strong>;
    const cite = /^\[(\d+(?:\s*,\s*\d+)*)\]$/.exec(p);
    if (cite) {
      return (
        <Fragment key={k}>
          {cite[1].split(/\s*,\s*/).map((n) => (
            <button key={n} className="cite" onClick={() => onCite(Number(n))} title={`Voir la source ${n}`}>
              {n}
            </button>
          ))}
        </Fragment>
      );
    }
    return <Fragment key={k}>{p}</Fragment>;
  });
}

export function AnswerText({ text, onCite }: { text: string; onCite: (n: number) => void }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) {
      blocks.push(
        <ul key={key}>
          {list.map((li, i) => (
            <li key={i}>{inline(li, onCite, `${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  text.split("\n").forEach((line, i) => {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) {
      list.push(m[1]);
      return;
    }
    flush(`ul-${i}`);
    if (line.trim()) {
      const h = /^#{1,4}\s+(.*)$/.exec(line);
      blocks.push(h ? <h4 key={i}>{inline(h[1], onCite, `h${i}`)}</h4> : <p key={i}>{inline(line, onCite, `p${i}`)}</p>);
    }
  });
  flush("ul-end");
  return <div className="answer-text">{blocks}</div>;
}
