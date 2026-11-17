// Client de l'API RegAssist. Les types reprennent les schémas Pydantic du backend
// (backend/app/api/schemas.py) : si l'un change, l'autre doit suivre.

const BASE = import.meta.env.VITE_API_URL ?? "/api";

export interface Source {
  number: number;
  chunk_id: string;
  document_id: string;
  label: string;
  reference: string | null;
  doc_title: string;
  article: string | null;
  page_start: number | null;
  page_end: number | null;
  excerpt: string;
}

export interface Chunk {
  id: string;
  article: string | null;
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
  context: string;
  content: string;
}

export interface Job {
  id: string;
  filename: string;
  status: "pending" | "running" | "done" | "failed" | "duplicate";
  step: string | null;
  progress: number;
  chunks_total: number;
  chunks_embedded: number;
  error: string | null;
  created_at: string;
}

export interface DocumentItem {
  id: string;
  doc_type: string;
  reference: string | null;
  title: string;
  issued_on: string | null;
  theme: string | null;
  status: string;
  page_start: number | null;
  page_end: number | null;
  chunk_count: number;
}

export interface Health {
  status: string;
  database: boolean;
  redis: boolean;
  llm_provider: string;
  embedding_provider: string;
  documents: number;
  chunks: number;
  chunks_embedded: number;
}

export type ChatEvent =
  | { type: "start"; conversation_id: string }
  | { type: "step"; node: string; label: string; detail: string }
  | {
      type: "answer";
      conversation_id: string;
      message_id: string;
      answer: string;
      sources: Source[];
      verification?: { uncited?: boolean };
    }
  | { type: "error"; message: string };

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail ?? `Erreur HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch(`${BASE}/health`).then((r) => json<Health>(r)),
  themes: () => fetch(`${BASE}/themes`).then((r) => json<string[]>(r)),
  documents: (q = "") =>
    fetch(`${BASE}/documents?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => json<DocumentItem[]>(r)),
  jobs: () => fetch(`${BASE}/jobs`).then((r) => json<Job[]>(r)),
  chunk: (id: string) => fetch(`${BASE}/chunks/${id}`).then((r) => json<Chunk>(r)),
  setStatus: (id: string, status: string) =>
    fetch(`${BASE}/documents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then((r) => json<DocumentItem>(r)),
  upload: (file: File, profile: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("profile", profile);
    return fetch(`${BASE}/documents`, { method: "POST", body: form }).then((r) => json<Job>(r));
  },

  /** Envoie une question et lit le flux SSE renvoyé par POST /api/chat.
   *  (EventSource ne gère que GET : on lit donc le flux « à la main ».) */
  async chat(
    question: string,
    conversationId: string | null,
    themes: string[],
    onEvent: (e: ChatEvent) => void,
    signal?: AbortSignal,
  ) {
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        conversation_id: conversationId,
        filters: { only_in_force: true, themes: themes.length ? themes : null },
      }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Erreur HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data) onEvent({ type: event, ...JSON.parse(data) } as ChatEvent);
      }
    }
  },
};
