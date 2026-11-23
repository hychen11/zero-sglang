import { Fragment, useState } from "react";
import { CodeBlock } from "../CodeBlock";
import { ComponentGraph } from "../ComponentGraph";
import { trace } from "../types";

export function ArchitectureView() {
  const [selected, setSelected] = useState<string>("coordinator");
  const component = trace.components.find((item) => item.id === selected);
  const outgoing = trace.edges.filter((edge) => edge.source === selected);
  const incoming = trace.edges.filter((edge) => edge.target === selected);
  const steps = trace.steps.filter((step) => step.node === selected);
  return (
    <div className="split">
      <div className="graph">
        <ComponentGraph selectedNode={selected} onSelect={setSelected} />
      </div>
      <div className="panel">
        {component ? (
          <>
            <h2>{component.label}</h2>
            <p className="meta">category: {component.category} · {trace.groups.find((group) => group.id === component.group)?.label}</p>
            <h3>Responsibility</h3>
            <p>{component.why}</p>
            <h3>Owns (state)</h3>
            <p>{component.owns}</p>
            <h3>Interfaces</h3>
            <p>{component.interfaces}</p>
            <h3>Input / Output</h3>
            <p>{component.io}</p>
            <h3>Related classes</h3>
            <p>{component.classes}</p>
            <h3>Concurrency</h3>
            <p>{component.concurrency}</p>
            <h3>Design decisions</h3>
            <p>{component.design}</p>
            <h3>How to debug</h3>
            <p>{component.debug}</p>
            <h3>Connections</h3>
            <dl className="kv">
              {incoming.map((edge) => (
                <Fragment key={`i-${edge.source}`}><dt>← {edge.source}</dt><dd className={`p-${edge.kind}`}>{edge.label}</dd></Fragment>
              ))}
              {outgoing.map((edge) => (
                <Fragment key={`o-${edge.target}`}><dt>→ {edge.target}</dt><dd className={`p-${edge.kind}`}>{edge.label}</dd></Fragment>
              ))}
            </dl>
            {steps.length > 0 && (
              <>
                <h3>Trace steps on this component</h3>
                <ul>
                  {steps.map((step) => (
                    <li key={step.id}>{step.title}</li>
                  ))}
                </ul>
              </>
            )}
            <h3>Source location</h3>
            <CodeBlock code={component.code} />
          </>
        ) : (
          <p>Select a component.</p>
        )}
      </div>
    </div>
  );
}
