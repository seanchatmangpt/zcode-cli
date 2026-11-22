/**
 * ggen-marketplace qualification court — pack.toml schema, SPARQL gate shape,
 * public-ontology-only gate, double-run capsule determinism, consumer config guard.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

import type { CourtVerdict, ExitCode, TransitionCourtAdapter } from "./types.ts";

/** Ratified public prefixes (Truex / 000_forbid_private_namespaces). */
export const PUBLIC_ONTOLOGY_PREFIXES = [
  "rdf:",
  "rdfs:",
  "xsd:",
  "owl:",
  "sh:",
  "shui:",
  "time:",
  "org:",
  "odrl:",
  "foaf:",
  "skos:",
  "prov:",
  "p-plan:",
  "dcterms:",
  "schema:",
  "fibo-fnd-acc-cur:",
  "fibo-fbc-pas-caa:",
  "ocel:",
  "airo:",
  "urn:uuid:",
  "urn:sha256:",
  "http://www.w3.org/",
  "https://www.w3.org/",
  "http://www.w3.org/ns/shacl-ui#",
  "http://www.w3.org/ns/shacl-ui/",
  "http://schema.org/",
  "https://schema.org/"
] as const;

/** Canonical URI bases for ratified CURIE prefixes in PUBLIC_ONTOLOGY_PREFIXES. */
export const PUBLIC_CURIE_URI_BASES: Record<string, readonly string[]> = {
  "rdf:": ["http://www.w3.org/1999/02/22-rdf-syntax-ns#"],
  "rdfs:": ["http://www.w3.org/2000/01/rdf-schema#"],
  "xsd:": ["http://www.w3.org/2001/XMLSchema#"],
  "owl:": ["http://www.w3.org/2002/07/owl#"],
  "sh:": ["http://www.w3.org/ns/shacl#"],
  "shui:": ["http://www.w3.org/ns/shacl-ui#", "http://www.w3.org/ns/shacl-ui/"],
  "time:": ["http://www.w3.org/2006/time#"],
  "org:": ["http://www.w3.org/ns/org#"],
  "odrl:": ["http://www.w3.org/ns/odrl/2/"],
  "foaf:": ["http://xmlns.com/foaf/0.1/", "https://xmlns.com/foaf/0.1/"],
  "skos:": ["http://www.w3.org/2004/02/skos/core#"],
  "prov:": ["http://www.w3.org/ns/prov#"],
  "p-plan:": ["http://purl.org/net/p-plan#", "https://purl.org/net/p-plan#"],
  "dcterms:": ["http://purl.org/dc/terms/", "https://purl.org/dc/terms/"],
  "schema:": ["http://schema.org/", "https://schema.org/"],
  "fibo-fnd-acc-cur:": [
    "https://spec.edmcouncil.org/fibo/ontology/FND/Accounting/CurrencyAmount/",
    "http://spec.edmcouncil.org/fibo/ontology/FND/Accounting/CurrencyAmount/"
  ],
  "fibo-fbc-pas-caa:": [
    "https://spec.edmcouncil.org/fibo/ontology/FBC/ProductsAndServices/ClientsAndAccounts/",
    "http://spec.edmcouncil.org/fibo/ontology/FBC/ProductsAndServices/ClientsAndAccounts/"
  ],
  "ocel:": ["http://www.ocel-standard.org/", "https://www.ocel-standard.org/"],
  "airo:": ["https://w3id.org/airo#", "http://w3id.org/airo#"]
};

export interface MarketplaceCourtOptions {
  /** Pack roots to qualify (absolute or cwd-relative). */
  packDirs?: string[];
  marketplaceCheckCmd?: string[];
  forbidAskQueries?: boolean;
  enforcePackTomlMinimal?: boolean;
  requireDoubleCapsuleCheck?: boolean;
  forbidConsumerPacksTable?: boolean;
  handwrittenMarker?: string;
  /** Optional Oxigraph/SPARQL runner for 000_forbid_private_namespaces.rq */
  runPrivateNsGate?: (rqPath: string, cwd: string) => { status: number; stdout: string; stderr: string };
  runCheck?: (cmd: string[], cwd: string) => { status: number; stdout: string; stderr: string };
}

const DEFAULT_HANDWRITTEN = "# UNSUPPORTED(generator-capability): handwritten";

export class MarketplaceCourtAdapter implements TransitionCourtAdapter {
  readonly name = "ggen-marketplace";
  private readonly opts: Required<
    Pick<
      MarketplaceCourtOptions,
      | "forbidAskQueries"
      | "enforcePackTomlMinimal"
      | "requireDoubleCapsuleCheck"
      | "forbidConsumerPacksTable"
      | "handwrittenMarker"
    >
  > &
    MarketplaceCourtOptions;

  constructor(opts: MarketplaceCourtOptions = {}) {
    this.opts = {
      forbidAskQueries: true,
      enforcePackTomlMinimal: true,
      requireDoubleCapsuleCheck: true,
      forbidConsumerPacksTable: true,
      handwrittenMarker: DEFAULT_HANDWRITTEN,
      marketplaceCheckCmd: ["python3", "marketplace.py", "check"],
      ...opts
    };
  }

  async validateWriteScope(files: string[]): Promise<ExitCode> {
    // Fail-closed: never short-circuit the batch. Consumer ggen.toml [packs.*]
    // (FM-CONFIG-101) is enforced post-transition via content scan; a lone
    // ggen.toml path is otherwise allowlisted like any non-generated path.
    for (const f of files) {
      const norm = f.replace(/\\/g, "/");
      if (/generated\//i.test(norm) || /_generated\./i.test(norm)) {
        return 1;
      }
    }
    return 0;
  }

  async verifyPostTransition(workspaceDir: string): Promise<CourtVerdict> {
    const diagnostics: string[] = [];
    const digests: Record<string, string> = {};
    const packDirs = this.opts.packDirs?.length
      ? this.opts.packDirs.map((p) => (p.startsWith("/") ? p : join(workspaceDir, p)))
      : discoverPackDirs(workspaceDir);

    for (const dir of packDirs) {
      const tomlPath = join(dir, "pack.toml");
      if (!existsSync(tomlPath)) continue;

      if (this.opts.enforcePackTomlMinimal) {
        const v = validatePackTomlMinimal(readFileSync(tomlPath, "utf8"));
        if (!v.ok) {
          diagnostics.push(`${tomlPath}: ${v.detail}`);
          return refuse(diagnostics, digests);
        }
      }

      if (this.opts.forbidAskQueries) {
        const nonSelect = findAskQueries(join(dir, "gates"));
        if (nonSelect.length > 0) {
          diagnostics.push(
            `Non-SELECT SPARQL queries (ASK/CONSTRUCT/DESCRIBE/UPDATE) forbidden in gates: ${nonSelect.join(", ")}`
          );
          return refuse(diagnostics, digests);
        }
      }

      const privateRq = join(dir, "gates", "000_forbid_private_namespaces.rq");
      const r = existsSync(privateRq)
        ? (
            this.opts.runPrivateNsGate ??
            ((rq, cwd) => {
              // Default: structural scan of ontology for private IRIs when no Oxigraph hook.
              return structuralPrivateNamespaceScan(cwd, rq);
            })
          )(privateRq, dir)
        : structuralPrivateNamespaceScan(dir, privateRq);
      if (r.status !== 0) {
        diagnostics.push(`private-namespace gate failed: ${(r.stderr || r.stdout).slice(0, 400)}`);
        return refuse(diagnostics, digests);
      }
      digests["private_ns_gate"] = sha256(r.stdout || "ok");
    }

    if (this.opts.forbidConsumerPacksTable) {
      const ggenToml = join(workspaceDir, "ggen.toml");
      if (existsSync(ggenToml)) {
        const text = readFileSync(ggenToml, "utf8");
        if (/^\s*\[packs\./m.test(text) || /^\s*\[packs\]/m.test(text)) {
          diagnostics.push("FM-CONFIG-101: consumer ggen.toml must not contain [packs.*]; use marketplace local-path contract");
          return refuse(diagnostics, digests, "BLOCKED");
        }
      }
    }

    if (this.opts.requireDoubleCapsuleCheck && this.opts.marketplaceCheckCmd) {
      const run =
        this.opts.runCheck ??
        ((cmd, cwd) => {
          const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd, encoding: "utf8", env: process.env });
          return { status: r.status ?? 1, stdout: r.stdout || "", stderr: r.stderr || "" };
        });
      const a = run(this.opts.marketplaceCheckCmd, workspaceDir);
      const b = run(this.opts.marketplaceCheckCmd, workspaceDir);
      if (a.status !== 0 || b.status !== 0) {
        diagnostics.push(`marketplace.py check failed: ${(a.stderr || b.stderr || a.stdout).slice(0, 400)}`);
        return refuse(diagnostics, digests);
      }
      const da = sha256(a.stdout);
      const db = sha256(b.stdout);
      digests["capsule_check_1"] = da;
      digests["capsule_check_2"] = db;
      if (da !== db) {
        diagnostics.push("marketplace.py check digests diverged across double-run (non-deterministic capsule)");
        return refuse(diagnostics, digests);
      }
    }

    return {
      exitCode: 0,
      standing: "ALIVE",
      diagnostics,
      artifactDigests: digests
    };
  }
}

function refuse(
  diagnostics: string[],
  digests: Record<string, string>,
  standing: CourtVerdict["standing"] = "REFUSED"
): CourtVerdict {
  return { exitCode: 1, standing, diagnostics, artifactDigests: digests };
}

export function validatePackTomlMinimal(text: string): { ok: boolean; detail: string } {
  // Minimal TOML parse for [pack] keys only — refuse unknown keys in that table.
  const lines = text.split(/\r?\n/);
  let inPack = false;
  const allowed = new Set(["name", "version", "description"]);
  const found = new Set<string>();
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      inPack = line === "[pack]";
      continue;
    }
    if (!inPack) continue;
    const m = line.match(/^([A-Za-z0-9_-]+)\s*=/);
    if (!m) continue;
    const key = m[1]!;
    if (!allowed.has(key)) {
      return { ok: false, detail: `pack.toml [pack] forbids key "${key}" (only name, version, description)` };
    }
    found.add(key);
  }
  for (const req of ["name", "version"]) {
    if (!found.has(req)) return { ok: false, detail: `pack.toml [pack] missing required key "${req}"` };
  }
  return { ok: true, detail: "ok" };
}

const FORBIDDEN_SPARQL_FORMS =
  /(?<![?$A-Za-z0-9_-])\b(?:ASK|CONSTRUCT|DESCRIBE|INSERT|DELETE|LOAD|CLEAR|DROP|CREATE|COPY|MOVE|ADD)\b/i;

function stripSparqlNoise(text: string): string {
  return text.replace(
    /<[^>]*>|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[^\r\n]*/g,
    (m) => (m.startsWith("<") ? " <> " : " ")
  );
}

/** Return true iff the SPARQL text is a SELECT-only query (no ASK/CONSTRUCT/DESCRIBE/UPDATE). */
export function isSelectOnlySparql(text: string): boolean {
  const body = stripSparqlNoise(text)
    .replace(/^\s*(?:(?:BASE\s+<>|PREFIX\s+[A-Za-z0-9_-]*:\s*<>)\s*)+/i, "")
    .trim();
  if (!/^SELECT\b/i.test(body)) return false;
  if (FORBIDDEN_SPARQL_FORMS.test(body)) return false;
  return true;
}

export function findAskQueries(gatesDir: string): string[] {
  if (!existsSync(gatesDir) || !statSync(gatesDir).isDirectory()) return [];
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const fullPath = join(dir, entry);
      const st = statSync(fullPath);
      if (st.isDirectory()) {
        walk(fullPath);
      } else if (entry.endsWith(".rq")) {
        const text = readFileSync(fullPath, "utf8");
        if (!isSelectOnlySparql(text)) {
          hits.push(relative(gatesDir, fullPath).replace(/\\/g, "/"));
        }
      }
    }
  };
  walk(gatesDir);
  return hits.sort();
}

const ALLOWED_URI_PREFIXES: readonly string[] = Array.from(
  new Set([
    ...PUBLIC_ONTOLOGY_PREFIXES.filter(
      (pre) => pre.startsWith("http://") || pre.startsWith("https://") || pre.startsWith("urn:")
    ),
    ...PUBLIC_ONTOLOGY_PREFIXES.flatMap((pre) => PUBLIC_CURIE_URI_BASES[pre] ?? [])
  ])
);

function isAllowedPublicIri(iri: string): boolean {
  return ALLOWED_URI_PREFIXES.some((pre) => iri.startsWith(pre));
}

export function structuralPrivateNamespaceScan(
  packDir: string,
  _rqPath: string
): { status: number; stdout: string; stderr: string } {
  const ontologyDir = join(packDir, "ontology");
  if (!existsSync(ontologyDir)) return { status: 0, stdout: "no-ontology", stderr: "" };
  const violations: string[] = [];
  const seen = new Set<string>();
  const record = (p: string, detail: string) => {
    const key = `${p}: ${detail}`;
    if (!seen.has(key)) {
      seen.add(key);
      violations.push(key);
    }
  };
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ttl") || name.endsWith(".rq")) {
        const lines = readFileSync(p, "utf8")
          .split(/\r?\n/)
          .filter((l) => !/^\s*#/.test(l));
        const text = lines.join("\n");
        // Parse @prefix (Turtle) and PREFIX (SPARQL) declarations fail-closed against allowlist.
        for (const m of text.matchAll(/(?:@prefix|(?<![A-Za-z0-9_@])PREFIX)\s+([A-Za-z0-9_-]*:)\s*<([^>]+)>/gi)) {
          const prefixName = m[1]!;
          const iri = m[2]!.trim();
          if (!isAllowedPublicIri(iri)) {
            record(p, `private prefix ${prefixName} <${iri}>`);
          }
        }
        // Fail-closed allowlist check on all angle-bracket URI/URN IRIs (canonical startsWith, no includes()).
        for (const m of text.matchAll(/<((?:https?:\/\/|urn:)[^>]+)>/gi)) {
          const iri = m[1]!.trim();
          if (!isAllowedPublicIri(iri)) {
            record(p, iri);
          }
        }
      }
    }
  };
  walk(ontologyDir);
  if (violations.length > 0) {
    return { status: 1, stdout: "", stderr: violations.slice(0, 20).join("\n") };
  }
  return { status: 0, stdout: "private-ns-clean", stderr: "" };
}

function discoverPackDirs(workspaceDir: string): string[] {
  const packs = join(workspaceDir, "packs");
  if (!existsSync(packs)) return [];
  return readdirSync(packs)
    .map((n) => join(packs, n))
    .filter((p) => existsSync(join(p, "pack.toml")));
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Assert handwritten files carry the UNSUPPORTED marker. */
export function requireHandwrittenAnnotation(
  filePath: string,
  marker = DEFAULT_HANDWRITTEN
): ExitCode {
  if (!existsSync(filePath)) return 2;
  const text = readFileSync(filePath, "utf8");
  return text.includes(marker) ? 0 : 1;
}
