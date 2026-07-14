import { useEffect, useState } from "react";
import { riftcoachApi } from "../api";
import type { CoachReport, KnowledgeContext, ScreenshotFrame, VisualObservation } from "../types";
import { formatDuration, formatDate } from "../utils";
import { buildVisualCards } from "../visual-cards";

export function ReportView({
  report,
  frames = [],
  observations = []
}: {
  report: CoachReport;
  frames?: ScreenshotFrame[];
  observations?: VisualObservation[];
}) {
  const casualMode = report.reviewType === "casual_mode";
  const providerText = `${providerLabel(report.provider)}${report.model ? ` - ${report.model}` : ""}`;
  const visualCards = buildVisualCards(frames, observations);

  return (
    <article className="report-view">
      <div className="report-hero">
        <div>
          <p className="eyebrow">{casualMode ? "Mode note" : "Post-game review"}</p>
          <h2>{report.mainMistake.title}</h2>
          <p className="muted">{providerText} - {formatDate(report.createdAtIso)}</p>
        </div>
        <div className="report-provider-badge">{providerText}</div>
      </div>

      <p className="lead">{report.summary}</p>

      {casualMode ? (
        <section className="report-panel positive">
          <p className="eyebrow">Casual mode</p>
          <h3>{report.positiveHabit.title}</h3>
          <p>{report.positiveHabit.explanation}</p>
          {report.warnings.length > 0 && <p className="metric">{report.warnings[0]}</p>}
        </section>
      ) : (
        <>
          <div className="report-grid">
            <section className="report-panel critical">
              <p className="eyebrow">Highest-impact issue</p>
              <h3>Main mistake</h3>
              <p>{report.mainMistake.explanation}</p>
              <h4>Evidence</h4>
              <ul className="evidence-list">{report.mainMistake.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
              <h4>Why it matters</h4>
              <p>{report.mainMistake.whyItMatters}</p>
            </section>

            <section className="report-panel positive">
              <p className="eyebrow">Keep doing this</p>
              <h3>{report.positiveHabit.title}</h3>
              <p>{report.positiveHabit.explanation}</p>

              <div className="drill-card">
                <p className="eyebrow">Next-game drill</p>
                <h3>{report.nextGameDrill.title}</h3>
                <ol>{report.nextGameDrill.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                <p className="metric">Success metric: {report.nextGameDrill.successMetric}</p>
              </div>
            </section>
          </div>

          {report.timelineNotes.length > 0 && (
            <section className="timeline card-subsection">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Match timeline</p>
                  <h3>Timeline notes</h3>
                </div>
              </div>
              {report.timelineNotes.map((note) => (
                <div key={`${note.timestampSec}-${note.title}`} className="timeline-row">
                  <span>{formatDuration(note.timestampSec)}</span>
                  <div><strong>{note.title}</strong><p>{note.note}</p></div>
                </div>
              ))}
            </section>
          )}

          {visualCards.length > 0 && (
            <section className="card-subsection visual-evidence">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Manual visual bookmarks</p>
                  <h3>Captured match frames</h3>
                </div>
              </div>
              <p className="muted visual-evidence-note">
                These frames are saved for your manual review. RiftCoach only presents a visual claim as evidence when it has been explicitly verified.
              </p>
              <div className="visual-grid">
                {visualCards.map((card) => (
                  <div className="visual-card" key={card.frame.id}>
                    <FrameThumbnail frame={card.frame} />
                    <div>
                      <span>
                        {formatDuration(card.timestampSec)} - {categoryLabel(card.category)} - {card.verified ? "verified" : "bookmark"}
                      </span>
                      <strong>{card.title}</strong>
                      <p>{card.details}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.knowledgeContext && (
            <KnowledgePanel knowledge={report.knowledgeContext} />
          )}

          {report.warnings.length > 0 && (
            <section className="warnings card-subsection">
              <p className="eyebrow">System notes</p>
              <h3>Warnings</h3>
              <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </section>
          )}
        </>
      )}
    </article>
  );
}

function KnowledgePanel({ knowledge }: { knowledge: KnowledgeContext }) {
  const sources = knowledge.webSources.slice(0, 5);
  return (
    <section className="card-subsection knowledge-context">
      <div className="section-title-row">
        <div>
          <p className="eyebrow">Knowledge context</p>
          <h3>{knowledge.evidenceMode === "telemetry_plus_web" ? "Web-enriched review" : "Telemetry-first review"}</h3>
        </div>
        <span className="pill small">{knowledge.mode}</span>
      </div>
      <p className="muted">{evidenceModeLabel(knowledge.evidenceMode)}</p>
      {sources.length > 0 ? (
        <div className="knowledge-list">
          {sources.map((source) => (
            <div className="knowledge-source" key={source.id}>
              <div>
                <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
                <span>{source.reliability} reliability - {source.query}</span>
              </div>
              <p>{source.snippet}</p>
            </div>
          ))}
        </div>
      ) : knowledge.mode === "web-assisted" ? (
        <p className="muted">No web sources were attached to this report.</p>
      ) : null}
      {knowledge.warnings.length > 0 && (
        <ul className="knowledge-warnings">
          {knowledge.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}
    </section>
  );
}

function FrameThumbnail({ frame }: { frame: ScreenshotFrame }) {
  const [src, setSrc] = useState<string>("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let canceled = false;
    setSrc("");
    setFailed(false);
    riftcoachApi.getFrameDataUrl(frame.filePath)
      .then((dataUrl) => {
        if (!canceled && typeof dataUrl === "string") setSrc(dataUrl);
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
    };
  }, [frame.filePath]);

  if (src) return <img className="frame-thumb" src={src} alt={`Review frame at ${formatDuration(frame.timestampSec)}`} />;
  return <div className="frame-placeholder">{failed ? "Frame unavailable" : "Loading frame"}</div>;
}

function categoryLabel(category: string) {
  return category.replace(/_/g, " ");
}

function providerLabel(provider: string) {
  if (provider.includes("ollama")) return "Ollama";
  if (provider.includes("openai")) return "OpenAI proxy";
  if (provider.includes("deterministic")) return "Legacy rules engine";
  return provider;
}

function evidenceModeLabel(mode: KnowledgeContext["evidenceMode"]) {
  if (mode === "telemetry_plus_web") return "The coach received local review evidence plus saved web snippets. Local evidence still takes priority.";
  if (mode === "telemetry_plus_benchmarks") return "The coach received local match telemetry plus built-in benchmark and matchup context.";
  return "The coach used local review evidence without external source snippets.";
}
