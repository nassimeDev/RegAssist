import { useCallback, useEffect, useState } from "react";
import { api, type Health } from "./api";
import { Chat } from "./components/Chat";
import { Documents } from "./components/Documents";

type Tab = "chat" | "documents";

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [health, setHealth] = useState<Health | null>(null);
  const [themes, setThemes] = useState<string[]>([]);

  const refresh = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.themes().then(setThemes).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">§</span>
          <div>
            <h1>RegAssist</h1>
            <p>Réglementation bancaire marocaine · sources Bank Al-Maghrib</p>
          </div>
        </div>
        <nav>
          <button className={tab === "chat" ? "active" : ""} onClick={() => setTab("chat")}>
            Assistant
          </button>
          <button className={tab === "documents" ? "active" : ""} onClick={() => setTab("documents")}>
            Documents
          </button>
        </nav>
        <div className={`health ${health?.status === "ok" ? "ok" : "ko"}`} title={health ? `${health.llm_provider} · ${health.embedding_provider}` : "API injoignable"}>
          {health ? `${health.documents} textes · ${health.chunks_embedded} passages` : "API hors ligne"}
        </div>
      </header>
      <main>{tab === "chat" ? <Chat themes={themes} /> : <Documents onChange={refresh} />}</main>
    </div>
  );
}
