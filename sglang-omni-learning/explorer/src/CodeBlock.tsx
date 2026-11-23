import { CodeRef, editorUrl, githubUrl } from "./types";

export function CodeBlock({ code }: { code: CodeRef }) {
  const editor = editorUrl(code);
  const lines = code.text.split("\n");
  return (
    <div>
      <div className="code-head">
        <span>
          {code.file}:{code.start}-{code.end}
        </span>
        {code.ambiguous && (
          <span className="badge b-INFERRED" title={`Anchor also matches lines ${code.ambiguous.join(", ")}; the first match is shown.`}>
            anchor ×{code.ambiguous.length}
          </span>
        )}
        <span className="links">
          {editor && <a href={editor}>open in editor</a>}
          <a href={githubUrl(code)} target="_blank" rel="noreferrer">
            GitHub @ commit
          </a>
        </span>
      </div>
      {code.missing ? (
        <p className="error-text">Anchor not found in the current checkout.</p>
      ) : (
        <pre className="code">
          {lines.map((line, index) => (
            <div key={index}>
              <span className="ln">{(code.start ?? 0) + index}</span>
              {line}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span>
        <span className="swatch" style={{ background: "var(--control)" }} />
        control
      </span>
      <span>
        <span className="swatch" style={{ background: "var(--data)" }} />
        data / payload
      </span>
      <span>
        <span className="swatch" style={{ background: "var(--stream)" }} />
        stream
      </span>
      <span>
        <span className="swatch" style={{ background: "var(--compute)" }} />
        compute
      </span>
      <span>evidence:</span>
      <span className="badge b-VERIFIED">VERIFIED</span>
      <span className="badge b-INFERRED">INFERRED</span>
      <span className="badge b-UNKNOWN">UNKNOWN</span>
      <span>source:</span>
      <span className="badge b-STATIC">STATIC</span>
      <span className="badge b-SIMULATED">SIMULATED</span>
      <span className="badge b-MEASURED">MEASURED</span>
    </div>
  );
}
