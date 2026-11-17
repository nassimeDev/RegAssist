import { useCallback, useEffect, useState } from "react";
import { api, type DocumentItem, type Job } from "../api";

const STATUS_LABEL: Record<Job["status"], string> = {
  pending: "En attente",
  running: "En cours",
  done: "Terminé",
  failed: "Échec",
  duplicate: "Déjà ingéré",
};

export function Documents({ onChange }: { onChange: () => void }) {
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState("generic");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.documents(query).then(setDocs).catch((e) => setError(e.message));
    api.jobs().then(setJobs).catch(() => undefined);
  }, [query]);

  // Attendre 300 ms après la dernière frappe avant d'interroger l'API (pas une requête par touche)
  useEffect(() => {
    const id = setTimeout(refresh, 300);
    return () => clearTimeout(id);
  }, [refresh]);

  // Tant qu'une ingestion tourne, on interroge l'API toutes les 2 secondes
  const active = jobs.some((j) => j.status === "pending" || j.status === "running");
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      refresh();
      onChange();
    }, 2000);
    return () => clearInterval(id);
  }, [active, refresh, onChange]);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      await api.upload(file, profile);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function toggle(d: DocumentItem) {
    await api.setStatus(d.id, d.status === "abroge" ? "en_vigueur" : "abroge");
    refresh();
  }

  return (
    <div className="documents">
      <section className="card">
        <h2>Ajouter un PDF</h2>
        <div className="row">
          <select value={profile} onChange={(e) => setProfile(e.target.value)}>
            <option value="generic">Document simple (une circulaire…)</option>
            <option value="bam_recueil">Recueil Bank Al-Maghrib (plusieurs textes)</option>
          </select>
          <label className="file">
            Choisir un fichier PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                upload(e.target.files?.[0]);
                e.target.value = ""; // permet de renvoyer le même fichier (ex. après un échec)
              }}
              hidden
            />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {jobs.length > 0 && (
          <table className="jobs">
            <thead>
              <tr>
                <th>Fichier</th>
                <th>Statut</th>
                <th>Étape</th>
                <th>Progression</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 8).map((j) => (
                <tr key={j.id} className={j.status}>
                  <td>{j.filename}</td>
                  <td>{STATUS_LABEL[j.status]}</td>
                  <td>{j.error ?? j.step}</td>
                  <td>
                    <progress value={j.progress} max={1} /> {j.chunks_embedded}/{j.chunks_total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Textes indexés ({docs.length})</h2>
          <input placeholder="Filtrer (titre, référence)…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <table className="docs">
          <thead>
            <tr>
              <th>Référence</th>
              <th>Titre</th>
              <th>Thème</th>
              <th>Pages</th>
              <th>Chunks</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} className={d.status}>
                <td>
                  <span className="type">{d.doc_type}</span> {d.reference ?? "—"}
                </td>
                <td className="title">{d.title}</td>
                <td className="theme">{d.theme ?? "—"}</td>
                <td>
                  {d.page_start}
                  {d.page_end && d.page_end !== d.page_start ? `–${d.page_end}` : ""}
                </td>
                <td>{d.chunk_count}</td>
                <td>
                  <button className="ghost small" onClick={() => toggle(d)} title="Basculer en vigueur / abrogé">
                    {d.status === "abroge" ? "Abrogé" : "En vigueur"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
