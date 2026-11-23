// Resolve every code anchor in ../docs/execution-trace.json against an sglang-omni checkout and write src/generated/trace.json.
// The checkout is SGLANG_OMNI_REPO, or the sibling directory ../../sglang-omni by default.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const explorerDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const learningRoot = resolve(explorerDir, "..");
const repoRoot = resolve(process.env.SGLANG_OMNI_REPO ?? join(learningRoot, "../sglang-omni"));
const tracePath = join(learningRoot, "docs/execution-trace.json");
const trace = JSON.parse(readFileSync(tracePath, "utf8"));

const fileCache = new Map();
const problems = [];

function readLines(file) {
  if (!fileCache.has(file)) {
    fileCache.set(file, readFileSync(join(repoRoot, file), "utf8").split("\n"));
  }
  return fileCache.get(file);
}

function resolveRef(ref, owner) {
  let lines;
  try {
    lines = readLines(ref.file);
  } catch {
    problems.push(`${owner}: file not found ${ref.file}`);
    return { ...ref, start: null, end: null, text: "", missing: true };
  }
  const matches = lines.flatMap((line, index) => (line.startsWith(ref.anchor) || line === ref.anchor ? [index] : []));
  if (matches.length === 0) {
    problems.push(`${owner}: anchor not found in ${ref.file}: ${JSON.stringify(ref.anchor)}`);
    return { ...ref, start: null, end: null, text: "", missing: true };
  }
  const startIndex = matches[0];
  const endIndex = Math.min(startIndex + ref.span, lines.length);
  return {
    file: ref.file,
    anchor: ref.anchor,
    start: startIndex + 1,
    end: endIndex,
    text: lines.slice(startIndex, endIndex).join("\n"),
    ambiguous: matches.length > 1 ? matches.map((index) => index + 1) : undefined,
    absPath: join(repoRoot, ref.file),
  };
}

for (const component of trace.components) {
  component.code = resolveRef(component, `component ${component.id}`);
}
for (const step of trace.steps) {
  step.code = step.code.map((ref) => resolveRef(ref, `step ${step.id}`));
}
for (const pipeline of trace.pipelines) {
  pipeline.configRef = resolveRef(pipeline.configRef, `pipeline ${pipeline.id}`);
}

let headCommit = null;
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot }).toString().trim();
} catch {
  headCommit = null;
}
trace.build = {
  resolvedAt: new Date().toISOString(),
  headCommit,
  matchesTraceCommit: headCommit === trace.provenance.commit,
};

mkdirSync(join(explorerDir, "src/generated"), { recursive: true });
writeFileSync(join(explorerDir, "src/generated/trace.json"), JSON.stringify(trace, null, 2));

const refCount = trace.steps.reduce((n, step) => n + step.code.length, 0) + trace.components.length + trace.pipelines.length;
console.log(`extract-snippets: resolved ${refCount} code references from ${fileCache.size} files (HEAD ${headCommit ?? "unknown"})`);
if (!trace.build.matchesTraceCommit) {
  console.warn(`extract-snippets: HEAD differs from the traced commit ${trace.provenance.commit}; snippets come from HEAD, re-verify the trace.`);
}
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
