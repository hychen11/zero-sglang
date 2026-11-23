import { useMemo, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { CodeRef, trace } from "../types";

interface Usage {
  code: CodeRef;
  usedBy: string[];
}

export function SourceView() {
  const [filter, setFilter] = useState("");
  const byFile = useMemo(() => {
    const usages = new Map<string, Usage>();
    const add = (code: CodeRef, owner: string) => {
      const key = `${code.file}:${code.start}`;
      const usage = usages.get(key) ?? { code, usedBy: [] };
      usage.usedBy.push(owner);
      usages.set(key, usage);
    };
    trace.steps.forEach((step, index) => step.code.forEach((code) => add(code, `step ${index + 1}: ${step.title}`)));
    trace.components.forEach((component) => add(component.code, `component: ${component.label}`));
    trace.pipelines.forEach((pipeline) => add(pipeline.configRef, `pipeline: ${pipeline.label}`));
    const groups = new Map<string, Usage[]>();
    for (const usage of usages.values()) {
      const list = groups.get(usage.code.file) ?? [];
      list.push(usage);
      groups.set(usage.code.file, list);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([file, list]) => [file, list.sort((a, b) => (a.code.start ?? 0) - (b.code.start ?? 0))] as const);
  }, []);
  const needle = filter.toLowerCase();
  return (
    <div className="full">
      <h2>Source code explorer</h2>
      <p>
        Every code location the trace cites, grouped by file. Snippets are read from this checkout at build time (HEAD <code>{trace.build.headCommit?.slice(0, 10) ?? "unknown"}</code>
        {trace.build.matchesTraceCommit ? ", same as the traced commit" : `, traced at ${trace.provenance.commit.slice(0, 10)}: re-verify`}).
      </p>
      <input type="text" placeholder="filter by file or text…" value={filter} onChange={(event) => setFilter(event.target.value)} style={{ width: "100%", maxWidth: 420, padding: "5px 8px" }} />
      {byFile
        .filter(([file, list]) => !needle || file.toLowerCase().includes(needle) || list.some((usage) => usage.code.text.toLowerCase().includes(needle)))
        .map(([file, list]) => (
          <div className="file-group" key={file}>
            <h3>{file}</h3>
            {list.map((usage) => (
              <div key={`${usage.code.file}:${usage.code.start}`}>
                <p className="meta">used by: {usage.usedBy.join(" · ")}</p>
                <CodeBlock code={usage.code} />
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
