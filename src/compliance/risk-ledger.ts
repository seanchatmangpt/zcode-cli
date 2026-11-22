import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ComplianceRefusalError,
  isHighRiskProfile,
  isRegulatedProfile,
  loadComplianceConfig,
  type ComplianceProfile,
  type ResolvedComplianceConfig
} from "./config.ts";

export function findPackageRoot(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: unknown };
        if (pkg.name === "zcode-app-cli") return dir;
      } catch {
        // continue walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(dirname(fileURLToPath(fromUrl)), "..", "..");
}

interface RdfTerm {
  kind: "iri" | "literal";
  value: string;
  lang?: string;
  datatype?: string;
}

type RdfBlockMap = Map<string, Map<string, RdfTerm[]>>;

function tokenizeTurtle(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i]!;
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }
    if (ch === "#") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "<") {
      const end = src.indexOf(">", i + 1);
      if (end < 0) throw new Error("Unterminated IRI in Turtle document");
      tokens.push(src.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (src.startsWith('"""', i)) {
      let j = i + 3;
      let val = "";
      while (j < n && !src.startsWith('"""', j)) {
        if (src[j] === "\\" && j + 1 < n) {
          val += src[j]! + src[j + 1]!;
          j += 2;
        } else {
          val += src[j]!;
          j++;
        }
      }
      j += 3;
      // consume optional @lang or ^^datatype
      let suffix = "";
      if (src[j] === "@") {
        const sStart = j;
        while (j < n && !/[\s.;,]/.test(src[j]!)) j++;
        suffix = src.slice(sStart, j);
      } else if (src.startsWith("^^", j)) {
        const sStart = j;
        j += 2;
        if (src[j] === "<") {
          const end = src.indexOf(">", j + 1);
          j = end >= 0 ? end + 1 : n;
        } else {
          while (j < n && !/[\s.;,]/.test(src[j]!)) j++;
        }
        suffix = src.slice(sStart, j);
      }
      tokens.push(`"""${val}"""${suffix}`);
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      let val = "";
      while (j < n && src[j] !== '"') {
        if (src[j] === "\\" && j + 1 < n) {
          val += src[j]! + src[j + 1]!;
          j += 2;
        } else {
          val += src[j]!;
          j++;
        }
      }
      j++;
      let suffix = "";
      if (src[j] === "@") {
        const sStart = j;
        while (j < n && !/[\s.;,]/.test(src[j]!)) j++;
        suffix = src.slice(sStart, j);
      } else if (src.startsWith("^^", j)) {
        const sStart = j;
        j += 2;
        if (src[j] === "<") {
          const end = src.indexOf(">", j + 1);
          j = end >= 0 ? end + 1 : n;
        } else {
          while (j < n && !/[\s.;,]/.test(src[j]!)) j++;
        }
        suffix = src.slice(sStart, j);
      }
      tokens.push(`"${val}"${suffix}`);
      i = j;
      continue;
    }
    if (ch === ";" || ch === "," || ch === ".") {
      tokens.push(ch);
      i++;
      continue;
    }
    const start = i;
    while (i < n && !/[\s.;,"<>#]/.test(src[i]!)) i++;
    tokens.push(src.slice(start, i));
  }

  return tokens;
}

function unescapeLiteralText(raw: string): string {
  return raw
    .replaceAll("\\n", "\n")
    .replaceAll("\\r", "\r")
    .replaceAll("\\t", "\t")
    .replaceAll('\\"', '"')
    .replaceAll("\\\\", "\\")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTerm(tok: string, prefixes: Map<string, string>): RdfTerm {
  if (tok.startsWith("<") && tok.endsWith(">")) {
    return { kind: "iri", value: tok.slice(1, -1) };
  }
  if (tok.startsWith('"""') || tok.startsWith('"')) {
    const isTriple = tok.startsWith('"""');
    const quoteLen = isTriple ? 3 : 1;
    const endQuote = isTriple ? tok.lastIndexOf('"""') : tok.lastIndexOf('"');
    const inner = tok.slice(quoteLen, endQuote);
    const tail = tok.slice(endQuote + quoteLen);
    let lang: string | undefined;
    let datatype: string | undefined;
    if (tail.startsWith("@")) lang = tail.slice(1);
    else if (tail.startsWith("^^")) datatype = resolvePrefixed(tail.slice(2), prefixes);
    return { kind: "literal", value: unescapeLiteralText(inner), lang, datatype };
  }
  if (tok === "a") {
    return { kind: "iri", value: "http://www.w3.org/1999/02/22-rdf-syntax-ns#type" };
  }
  return { kind: "iri", value: resolvePrefixed(tok, prefixes) };
}

function resolvePrefixed(tok: string, prefixes: Map<string, string>): string {
  if (tok.startsWith("<") && tok.endsWith(">")) return tok.slice(1, -1);
  const colon = tok.indexOf(":");
  if (colon < 0) return tok;
  const prefix = tok.slice(0, colon);
  const local = tok.slice(colon + 1);
  const base = prefixes.get(prefix);
  return base ? `${base}${local}` : tok;
}

function compactIri(iri: string, prefixes: Map<string, string>): string {
  for (const [pfx, ns] of prefixes.entries()) {
    if (iri.startsWith(ns)) return `${pfx}:${iri.slice(ns.length)}`;
  }
  return iri;
}

function localName(iri: string): string {
  const hash = iri.lastIndexOf("#");
  if (hash >= 0) return iri.slice(hash + 1);
  const slash = iri.lastIndexOf("/");
  if (slash >= 0) return iri.slice(slash + 1);
  const colon = iri.lastIndexOf(":");
  return colon >= 0 ? iri.slice(colon + 1) : iri;
}

function parseTurtleStatements(src: string): { prefixes: Map<string, string>; subjects: RdfBlockMap } {
  const tokens = tokenizeTurtle(src);
  const prefixes = new Map<string, string>();
  const subjects: RdfBlockMap = new Map();

  let idx = 0;
  while (idx < tokens.length) {
    const tok = tokens[idx]!;
    if (tok === "@prefix") {
      const pfx = tokens[idx + 1] ?? "";
      const ns = tokens[idx + 2] ?? "";
      const dot = tokens[idx + 3];
      if (pfx.endsWith(":") && ns.startsWith("<") && ns.endsWith(">") && dot === ".") {
        prefixes.set(pfx.slice(0, -1), ns.slice(1, -1));
        idx += 4;
        continue;
      }
    }
    if (tok === ".") {
      idx++;
      continue;
    }

    const subjTerm = parseTerm(tok, prefixes);
    idx++;
    let predMap = subjects.get(subjTerm.value);
    if (!predMap) {
      predMap = new Map();
      subjects.set(subjTerm.value, predMap);
    }

    while (idx < tokens.length) {
      const pTok = tokens[idx]!;
      if (pTok === ".") {
        idx++;
        break;
      }
      if (pTok === ";") {
        idx++;
        continue;
      }
      const predTerm = parseTerm(pTok, prefixes);
      idx++;
      const existing = predMap.get(predTerm.value) ?? [];
      while (idx < tokens.length) {
        const oTok = tokens[idx]!;
        if (oTok === ";" || oTok === ".") break;
        if (oTok === ",") {
          idx++;
          continue;
        }
        existing.push(parseTerm(oTok, prefixes));
        idx++;
      }
      predMap.set(predTerm.value, existing);
    }
  }

  return { prefixes, subjects };
}

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";
const DCTERMS_DESC = "http://purl.org/dc/terms/description";
const AIRO = "https://w3id.org/airo#";
const EUAI = "https://zcode-cli.example/ontology/eu-ai-act#";
const ZC = "https://zcode-cli.example/ontology/airo#";

function getLiteral(preds: Map<string, RdfTerm[]> | undefined, prop: string): string | undefined {
  return preds?.get(prop)?.[0]?.value;
}

function getAllValues(preds: Map<string, RdfTerm[]> | undefined, prop: string): string[] {
  return (preds?.get(prop) ?? []).map((t) => t.value);
}

function hasRdfType(preds: Map<string, RdfTerm[]> | undefined, typeIri: string): boolean {
  return (preds?.get(RDF_TYPE) ?? []).some((t) => t.value === typeIri);
}

export interface RiskRegisterArticle {
  id: string;
  articleNumber: string;
  legalBasis: string;
  label: string;
  description: string;
  targetModule?: string;
  targetMilestone?: string;
  seeAlso: string[];
}

export interface RiskRegisterMapping {
  id: string;
  articleNumber: string;
  targetArticle: string;
  label: string;
  riskControls: string[];
  seeAlso: string[];
}

export interface RiskRegisterEntry {
  id: string;
  iri: string;
  source_ontology: "ontology/airo_risk_description.ttl" | "ontology/eu-ai-act.ttl";
  label: string;
  description?: string;
  article: string;
  articles: string[];
  likelihood: string;
  severity?: string;
  consequence?: string;
  sources: string[];
  controls: string[];
  stakeholders: string[];
  inherentRiskScore?: number;
  residualRiskScore?: number;
  residualRiskThreshold?: number;
  riskUnit?: string;
  withinThreshold: boolean;
  seeAlso: string[];
}

export interface RiskRegisterReport {
  schema: "zcode.risk-register/1";
  regulation: "Regulation (EU) 2024/1689";
  profile: ComplianceProfile;
  standing: "UNVERIFIED" | "PARTIAL_ALIVE";
  ontologies: readonly ["ontology/airo_risk_description.ttl", "ontology/eu-ai-act.ttl"];
  articles: RiskRegisterArticle[];
  mappings: RiskRegisterMapping[];
  risks: RiskRegisterEntry[];
  controls: Array<{
    id: string;
    label: string;
    targetModule?: string;
    targetMilestone?: string;
    seeAlso: string[];
  }>;
  declare_constraints: Array<{
    id: string;
    template: string;
    activator: string;
    target?: string;
    articles: string[];
    antiVacuityRequired: boolean;
  }>;
  summary: {
    total_risks: number;
    airo_baseline_risks: number;
    eu_ai_act_risks: number;
    article_mappings_count: number;
    articles_covered: string[];
    all_residual_within_threshold: boolean;
    file_uris_verified: boolean;
    dangling_file_uris: string[];
  };
  uncertainty_note: string;
}

export interface LoadRiskRegisterOptions {
  packageRoot?: string;
  config?: ResolvedComplianceConfig;
  configPath?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function loadAiroRiskRegister(options: LoadRiskRegisterOptions = {}): RiskRegisterReport {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cfg =
    options.config ??
    loadComplianceConfig({
      cwd: options.cwd,
      configPath: options.configPath,
      env: options.env
    });

  const airoRel = "ontology/airo_risk_description.ttl";
  const euActRel = "ontology/eu-ai-act.ttl";
  const airoPath = join(pkgRoot, airoRel);
  const euActPath = join(pkgRoot, euActRel);

  const airoRaw = readFileSync(airoPath, "utf8");
  const euActRaw = readFileSync(euActPath, "utf8");

  const airoParsed = parseTurtleStatements(airoRaw);
  const euActParsed = parseTurtleStatements(euActRaw);

  const mergedPrefixes = new Map<string, string>([
    ...airoParsed.prefixes.entries(),
    ...euActParsed.prefixes.entries()
  ]);

  // Verify <file:...> URIs exist on disk
  const allFileUris = new Set<string>();
  for (const rawText of [airoRaw, euActRaw]) {
    for (const m of rawText.matchAll(/<file:([^>]+)>/g)) {
      if (m[1]) allFileUris.add(m[1]);
    }
  }
  const danglingFileUris: string[] = [];
  for (const uri of allFileUris) {
    const abs = uri.startsWith("/") ? uri : resolve(pkgRoot, uri);
    if (!existsSync(abs)) danglingFileUris.push(uri);
  }

  // Extract EU AI Act articles
  const articles: RiskRegisterArticle[] = [];
  const articleNumByIri = new Map<string, string>();
  for (const [subj, preds] of euActParsed.subjects.entries()) {
    if (!hasRdfType(preds, `${EUAI}EuAiActArticle`)) continue;
    const articleNumber = getLiteral(preds, `${EUAI}articleNumber`) ?? "";
    const id = localName(subj);
    articleNumByIri.set(subj, articleNumber);
    articles.push({
      id,
      articleNumber,
      legalBasis: compactIri(getLiteral(preds, `${EUAI}legalBasis`) ?? "", mergedPrefixes),
      label: getLiteral(preds, RDFS_LABEL) ?? id,
      description: getLiteral(preds, DCTERMS_DESC) ?? "",
      targetModule: getLiteral(preds, `${EUAI}targetModule`),
      targetMilestone: getLiteral(preds, `${EUAI}targetMilestone`),
      seeAlso: getAllValues(preds, RDFS_SEE_ALSO)
    });
  }
  articles.sort((a, b) => Number(a.articleNumber) - Number(b.articleNumber));

  // Extract Article 9/12/14/15 mappings from airo_risk_description.ttl
  // Supports both legacy zc:EuAiActArticleMapping nodes and unified direct euai:addressesArticle links.
  const mappings: RiskRegisterMapping[] = [];
  const articlesByControlId = new Map<string, Set<string>>();
  const seenMappingArticles = new Set<string>();
  for (const [subj, preds] of airoParsed.subjects.entries()) {
    if (!hasRdfType(preds, `${ZC}EuAiActArticleMapping`)) continue;
    const artNum = getLiteral(preds, `${ZC}articleNumber`) ?? "";
    const target = localName(getLiteral(preds, `${ZC}mapsTarget`) ?? "");
    const mappedControls = getAllValues(preds, `${ZC}mapsRiskControl`).map(localName);
    for (const cid of mappedControls) {
      let set = articlesByControlId.get(cid);
      if (!set) {
        set = new Set();
        articlesByControlId.set(cid, set);
      }
      if (artNum) set.add(`Art. ${artNum}`);
    }
    if (artNum) seenMappingArticles.add(artNum);
    mappings.push({
      id: localName(subj),
      articleNumber: artNum,
      targetArticle: target,
      label: getLiteral(preds, RDFS_LABEL) ?? localName(subj),
      riskControls: mappedControls,
      seeAlso: getAllValues(preds, RDFS_SEE_ALSO)
    });
  }

  // Synthesize mappings from unified direct euai:addressesArticle links on airo_risk_description.ttl
  const directByArticle = new Map<
    string,
    { targetArticle: string; controls: Set<string>; seeAlso: Set<string> }
  >();
  for (const [subj, preds] of airoParsed.subjects.entries()) {
    const addressed = getAllValues(preds, `${EUAI}addressesArticle`);
    if (addressed.length === 0) continue;
    const isControl = hasRdfType(preds, `${AIRO}RiskControl`);
    const subjId = localName(subj);
    const subjSeeAlso = getAllValues(preds, RDFS_SEE_ALSO);
    for (const artIri of addressed) {
      const target = localName(artIri);
      const artMeta = articles.find((a) => a.id === target);
      const numMatch = target.match(/(\d+)/);
      const artNum = artMeta?.articleNumber ?? (numMatch ? numMatch[1]! : "");
      if (!artNum || seenMappingArticles.has(artNum)) continue;
      let bucket = directByArticle.get(artNum);
      if (!bucket) {
        bucket = { targetArticle: target, controls: new Set(), seeAlso: new Set() };
        directByArticle.set(artNum, bucket);
      }
      if (isControl) {
        bucket.controls.add(subjId);
        let set = articlesByControlId.get(subjId);
        if (!set) {
          set = new Set();
          articlesByControlId.set(subjId, set);
        }
        set.add(`Art. ${artNum}`);
      }
      for (const s of subjSeeAlso) bucket.seeAlso.add(s);
    }
  }
  for (const [artNum, bucket] of [...directByArticle.entries()].sort(
    (a, b) => Number(a[0]) - Number(b[0])
  )) {
    const artMeta = articles.find((a) => a.articleNumber === artNum);
    mappings.push({
      id: `Article_${artNum}_Mapping`,
      articleNumber: artNum,
      targetArticle: bucket.targetArticle,
      label: artMeta?.label ?? `EU AI Act Article ${artNum}`,
      riskControls: [...bucket.controls].sort(),
      seeAlso: [...bucket.seeAlso].sort()
    });
  }

  // Index RiskSources by target Risk IRI
  const sourcesByRiskIri = new Map<string, string[]>();
  for (const parsed of [airoParsed, euActParsed]) {
    for (const [subj, preds] of parsed.subjects.entries()) {
      if (!hasRdfType(preds, `${AIRO}RiskSource`)) continue;
      for (const riskIri of getAllValues(preds, `${AIRO}isRiskSourceFor`)) {
        const list = sourcesByRiskIri.get(riskIri) ?? [];
        list.push(localName(subj));
        sourcesByRiskIri.set(riskIri, list);
      }
    }
  }

  // Controls index
  const controls: RiskRegisterReport["controls"] = [];
  for (const parsed of [airoParsed, euActParsed]) {
    for (const [subj, preds] of parsed.subjects.entries()) {
      if (!hasRdfType(preds, `${AIRO}RiskControl`)) continue;
      controls.push({
        id: localName(subj),
        label: getLiteral(preds, RDFS_LABEL) ?? localName(subj),
        targetModule: getLiteral(preds, `${EUAI}targetModule`),
        targetMilestone: getLiteral(preds, `${EUAI}targetMilestone`),
        seeAlso: getAllValues(preds, RDFS_SEE_ALSO)
      });
    }
  }

  const risks: RiskRegisterEntry[] = [];

  // Baseline AIRO risks from airo_risk_description.ttl
  let airoBaselineCount = 0;
  for (const [subj, preds] of airoParsed.subjects.entries()) {
    if (!hasRdfType(preds, `${AIRO}Risk`)) continue;
    airoBaselineCount++;
    const id = localName(subj);
    const controlIris = getAllValues(preds, `${AIRO}hasRiskControl`);
    const controlIds = controlIris.map(localName);
    const likelihoodIri = getLiteral(preds, `${AIRO}hasLikelihood`) ?? "";
    const likelihoodLabel =
      getLiteral(airoParsed.subjects.get(likelihoodIri), RDFS_LABEL) ?? localName(likelihoodIri);
    const consequenceIri = getLiteral(preds, `${AIRO}hasConsequence`) ?? "";
    const consPreds = airoParsed.subjects.get(consequenceIri);
    const sevIri = getLiteral(consPreds, `${AIRO}hasSeverity`) ?? "";
    const sevLabel = getLiteral(airoParsed.subjects.get(sevIri), RDFS_LABEL) ?? localName(sevIri);
    const impactIri = getLiteral(consPreds, `${AIRO}hasImpact`) ?? "";
    const impPreds = airoParsed.subjects.get(impactIri);
    const stakeholders = getAllValues(impPreds, `${AIRO}hasImpactOnStakeholder`).map(localName);

    const artSet = new Set<string>(["Art. 9"]);
    for (const cid of controlIds) {
      for (const mappedArt of articlesByControlId.get(cid) ?? []) {
        artSet.add(mappedArt);
      }
    }
    if (id === "Risk_ContractDrift") {
      artSet.add("Art. 15");
    }
    const artList = [...artSet];

    risks.push({
      id,
      iri: subj,
      source_ontology: "ontology/airo_risk_description.ttl",
      label: getLiteral(preds, RDFS_LABEL) ?? id,
      description: getLiteral(preds, DCTERMS_DESC),
      article: artList[0]!,
      articles: artList,
      likelihood: likelihoodLabel || "possible",
      severity: sevLabel || undefined,
      consequence: getLiteral(consPreds, RDFS_LABEL) ?? (consequenceIri ? localName(consequenceIri) : undefined),
      sources: sourcesByRiskIri.get(subj) ?? [],
      controls: controlIds,
      stakeholders,
      withinThreshold: true,
      seeAlso: getAllValues(preds, RDFS_SEE_ALSO)
    });
  }

  // EU AI Act operational risks from eu-ai-act.ttl
  let euAiActRiskCount = 0;
  for (const [subj, preds] of euActParsed.subjects.entries()) {
    if (!hasRdfType(preds, `${AIRO}Risk`)) continue;
    euAiActRiskCount++;
    const id = localName(subj);
    const artIris = getAllValues(preds, `${EUAI}addressesArticle`);
    const artList = artIris.map((iri) => {
      const num = articleNumByIri.get(iri);
      return num ? `Art. ${num}` : localName(iri);
    });
    const likelihoodIri = getLiteral(preds, `${AIRO}hasLikelihood`) ?? "";
    const likelihoodLabel =
      getLiteral(euActParsed.subjects.get(likelihoodIri), RDFS_LABEL) ?? localName(likelihoodIri);
    const consequenceIri = getLiteral(preds, `${AIRO}hasConsequence`) ?? "";
    const consPreds = euActParsed.subjects.get(consequenceIri);
    const sevIri = getLiteral(consPreds, `${AIRO}hasSeverity`) ?? "";
    const sevLabel = getLiteral(euActParsed.subjects.get(sevIri), RDFS_LABEL) ?? localName(sevIri);
    const impactIri = getLiteral(consPreds, `${AIRO}hasImpact`) ?? "";
    const impPreds = euActParsed.subjects.get(impactIri);
    const stakeholders = getAllValues(impPreds, `${AIRO}hasImpactOnStakeholder`).map(localName);
    const controlIds = getAllValues(preds, `${AIRO}hasRiskControl`).map(localName);

    const inhRaw = getLiteral(preds, `${EUAI}inherentRiskScore`);
    const resRaw = getLiteral(preds, `${EUAI}residualRiskScore`);
    const thrRaw = getLiteral(preds, `${EUAI}residualRiskThreshold`);
    const inh = inhRaw !== undefined ? Number(inhRaw) : undefined;
    const res = resRaw !== undefined ? Number(resRaw) : undefined;
    const thr = thrRaw !== undefined ? Number(thrRaw) : undefined;
    const withinThreshold =
      inh !== undefined &&
      res !== undefined &&
      thr !== undefined &&
      Number.isFinite(inh) &&
      Number.isFinite(res) &&
      Number.isFinite(thr) &&
      0 < res &&
      res <= thr &&
      thr < inh &&
      inh <= 1;

    risks.push({
      id,
      iri: subj,
      source_ontology: "ontology/eu-ai-act.ttl",
      label: getLiteral(preds, RDFS_LABEL) ?? id,
      article: artList[0] ?? "Art. 9",
      articles: artList.length > 0 ? artList : ["Art. 9"],
      likelihood: likelihoodLabel || "possible",
      severity: sevLabel || undefined,
      consequence: getLiteral(consPreds, RDFS_LABEL) ?? (consequenceIri ? localName(consequenceIri) : undefined),
      sources: sourcesByRiskIri.get(subj) ?? [],
      controls: controlIds,
      stakeholders,
      inherentRiskScore: inh,
      residualRiskScore: res,
      residualRiskThreshold: thr,
      riskUnit: getLiteral(preds, `${EUAI}riskUnit`),
      withinThreshold,
      seeAlso: getAllValues(preds, RDFS_SEE_ALSO)
    });
  }

  // Declare constraints
  const declareConstraints: RiskRegisterReport["declare_constraints"] = [];
  for (const [subj, preds] of euActParsed.subjects.entries()) {
    if (!hasRdfType(preds, `${EUAI}DeclareConstraint`)) continue;
    const artNums = getAllValues(preds, `${EUAI}addressesArticle`).map((iri) => {
      const n = articleNumByIri.get(iri);
      return n ? `Art. ${n}` : localName(iri);
    });
    declareConstraints.push({
      id: localName(subj),
      template: getLiteral(preds, `${EUAI}declareTemplate`) ?? "",
      activator: getLiteral(preds, `${EUAI}declareActivator`) ?? "",
      target: getLiteral(preds, `${EUAI}declareTarget`),
      articles: artNums,
      antiVacuityRequired: getLiteral(preds, `${EUAI}antiVacuityRequired`) === "true"
    });
  }

  const articlesCovered = Array.from(
    new Set([
      ...articles.map((a) => `Art. ${a.articleNumber}`),
      ...mappings.map((m) => `Art. ${m.articleNumber}`)
    ])
  ).sort((a, b) => Number(a.replace("Art. ", "")) - Number(b.replace("Art. ", "")));

  const allResidualWithin = risks.every((r) => r.withinThreshold);

  return {
    schema: "zcode.risk-register/1",
    regulation: "Regulation (EU) 2024/1689",
    profile: cfg.compliance.profile,
    standing: "UNVERIFIED",
    ontologies: [airoRel, euActRel],
    articles,
    mappings,
    risks,
    controls,
    declare_constraints: declareConstraints,
    summary: {
      total_risks: risks.length,
      airo_baseline_risks: airoBaselineCount,
      eu_ai_act_risks: euAiActRiskCount,
      article_mappings_count: mappings.length,
      articles_covered: articlesCovered,
      all_residual_within_threshold: allResidualWithin,
      file_uris_verified: danglingFileUris.length === 0,
      dangling_file_uris: danglingFileUris
    },
    uncertainty_note:
      "Ontology risk scores and controls are design-time specifications (standing: UNVERIFIED); run `zcode compliance assess --logs <dir>` to substantiate runtime conformance over observed OCEL 2.0 soak logs."
  };
}

export function formatRiskRegisterMarkdown(report: RiskRegisterReport): string {
  const lines: string[] = [
    "# EU AI Act Article 9 Risk Register (W3C AIRO + DPV)",
    "",
    `- **Regulation**: ${report.regulation}`,
    `- **Active Profile**: \`${report.profile}\``,
    `- **Standing**: \`${report.standing}\` (${report.uncertainty_note})`,
    `- **Ontologies**: ${report.ontologies.map((o) => `\`${o}\``).join(", ")}`,
    `- **Residual Risk Thresholds**: ${report.summary.all_residual_within_threshold ? "ALL WITHIN THRESHOLD" : "THRESHOLD EXCEEDED"}`,
    "",
    "## Risk Matrix",
    "",
    "| Risk ID | Source | Articles | Likelihood | Inherent | Residual | Threshold | Controls |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const r of report.risks) {
    const inh = r.inherentRiskScore !== undefined ? r.inherentRiskScore.toFixed(2) : "qualitative";
    const res = r.residualRiskScore !== undefined ? r.residualRiskScore.toFixed(2) : "qualitative";
    const thr = r.residualRiskThreshold !== undefined ? r.residualRiskThreshold.toFixed(2) : "n/a";
    lines.push(
      `| \`${r.id}\` | \`${r.source_ontology}\` | ${r.articles.join(", ")} | ${r.likelihood} | ${inh} | ${res} | ${thr} | ${r.controls.map((c) => `\`${c}\``).join(", ")} |`
    );
  }

  lines.push(
    "",
    "## EU AI Act Article Mappings (Arts. 9, 12, 14, 15)",
    "",
    "| Mapping ID | Article | Description |",
    "| --- | --- | --- |"
  );
  for (const m of report.mappings) {
    lines.push(`| \`${m.id}\` | Art. ${m.articleNumber} | ${m.label} |`);
  }

  return lines.join("\n") + "\n";
}

export interface ComplianceInfoReport {
  schema: "zcode.compliance-info/1";
  regulation: "Regulation (EU) 2024/1689";
  article: "Article 13 (Instructions for Use & Deployer Information)";
  provider: {
    name: string;
    repository: string;
    license: string;
    package_name: string;
    package_version: string;
  };
  ai_system: {
    name: string;
    distribution_version: string;
    runtime_app_version: string;
    runtime_cli_version: string;
    runtime_lock_sha512: string;
    node_engine_requirement: string;
  };
  compliance_profile: ComplianceProfile;
  regulated: boolean;
  high_risk: boolean;
  intended_purpose: string;
  prohibited_and_out_of_scope_uses: string[];
  limitations_and_constraints: string[];
  human_oversight: {
    article: "Art. 14";
    overseer_id: string | null;
    allow_yolo: boolean;
    min_review_ms: number;
    emergency_stop_supported: boolean;
    automation_bias_monitoring: boolean;
    subagent_oversight_propagation: boolean;
  };
  accuracy_robustness_cybersecurity: {
    article: "Art. 15";
    alignment_method: "a_star_alignment";
    declare_rules_count: number;
    transactional_rollback_supported: boolean;
    max_retries_per_signature: number;
    kingman_heavy_tail_separation: boolean;
    standing: "UNVERIFIED";
  };
  record_keeping_and_pmm: {
    articles: readonly ["Art. 12", "Art. 72", "Art. 73"];
    ocel_standard: "IEEE OCEL 2.0 (JSON / SQLite WAL / XML)";
    log_retention_days: number;
    monitoring_enabled: boolean;
    drift_alpha: number;
    min_window: number;
    k_anonymity: number;
  };
  standing: "UNVERIFIED";
  runtime_standing: "UNVERIFIED";
  alignment_standing: "UNVERIFIED";
  uncertainty_caveats: string[];
  instructions_for_use_path: "docs/INSTRUCTIONS_FOR_USE.md";
}

export function buildComplianceInfo(options: LoadRiskRegisterOptions = {}): ComplianceInfoReport {
  const pkgRoot = options.packageRoot ?? findPackageRoot();
  const cfg =
    options.config ??
    loadComplianceConfig({
      cwd: options.cwd,
      configPath: options.configPath,
      env: options.env
    });

  const pkg = JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as {
    name?: string;
    version?: string;
    author?: string;
    license?: string;
    repository?: { url?: string };
    engines?: { node?: string };
  };
  const lock = JSON.parse(readFileSync(join(pkgRoot, "zcode-runtime.lock.json"), "utf8")) as {
    appVersion?: string;
    sha512?: string;
  };
  let runtimeCliVersion = "0.16.9";
  try {
    const ext = JSON.parse(readFileSync(join(pkgRoot, "vendor", "extraction.json"), "utf8")) as {
      cliVersion?: string;
    };
    if (ext.cliVersion) runtimeCliVersion = ext.cliVersion;
  } catch {
    // vendor/extraction.json is optional in fresh-clone hermetic environments
  }

  const profile = cfg.compliance.profile;
  const regulated = isRegulatedProfile(profile);
  const highRisk = isHighRiskProfile(profile);

  const prohibited = highRisk
    ? [
        `PROHIBITED under '${profile}': autonomous safety-critical or critical-infrastructure actuation without named human overseer_id.`,
        `PROHIBITED under '${profile}': unattended permission bypass (--mode yolo, --dangerously-skip-permissions, --permission-mode bypassPermissions|dontAsk, allow_yolo=true).`,
        `PROHIBITED under '${profile}': disabling Art. 12 OCEL logging (ZCODE_OCEL=0 & ZCODE_COMPLIANCE_LOG=0) or reducing log_retention_days below 180.`,
        "PROHIBITED: EU AI Act Art. 5 prohibited practices (subliminal manipulation, social scoring, untargeted facial scraping, biometric categorization)."
      ]
    : regulated
      ? [
          `PROHIBITED under '${profile}': suppressing Art. 50(1) AI interaction disclosure (ZCODE_SUPPRESS_DISCLOSURE=1) or stripping Art. 50(2) provenance sidecars.`,
          "OUT OF SCOPE: unreviewed autonomous production deployment in Annex I / Annex III high-risk domains without switching to high-risk-annex-iii or high-risk-annex-i."
        ]
      : [
          "Standard developer mode does not enforce high-risk Art. 14/26/27 deployer gates; switch to 'art50-only', 'high-risk-annex-iii', or 'high-risk-annex-i' for regulated deployments.",
          "PROHIBITED: unattended safety-critical actuation or EU AI Act Art. 5 prohibited AI practices."
        ];

  return {
    schema: "zcode.compliance-info/1",
    regulation: "Regulation (EU) 2024/1689",
    article: "Article 13 (Instructions for Use & Deployer Information)",
    provider: {
      name: pkg.author ?? "zcode-cli maintainers",
      repository: pkg.repository?.url ?? "https://github.com/kingsword09/zcode-cli",
      license: pkg.license ?? "MIT",
      package_name: pkg.name ?? "zcode-app-cli",
      package_version: pkg.version ?? "0.0.0"
    },
    ai_system: {
      name: "zcode-cli",
      distribution_version: pkg.version ?? "0.0.0",
      runtime_app_version: lock.appVersion ?? "0.0.0",
      runtime_cli_version: runtimeCliVersion,
      runtime_lock_sha512: lock.sha512 ?? "",
      node_engine_requirement: pkg.engines?.node ?? ">=22.19.0"
    },
    compliance_profile: profile,
    regulated,
    high_risk: highRisk,
    intended_purpose:
      "CLI/TUI wrapper and EU AI Act process-intelligence compliance layer around the vendored ZCode coding-agent runtime, operating under human oversight and the CONSTRUCT ceiling.",
    prohibited_and_out_of_scope_uses: prohibited,
    limitations_and_constraints: [
      "LLM outputs are non-deterministic candidates and must be verified by tests, compilers, and human reviewers before production merge.",
      "Coding turn durations exhibit heavy-tailed variance (c_s^2 >> 1); Kingman queueing limits concurrency to protect valid throughput (lambda_alive).",
      "Static metadata inspection does NOT prove runtime conformance; empirical standing requires observed OCEL 2.0 soak logs verified via `zcode compliance assess --logs <dir>`."
    ],
    human_oversight: {
      article: "Art. 14",
      overseer_id: cfg.deployer.overseer_id ?? null,
      allow_yolo: cfg.compliance.allow_yolo,
      min_review_ms: cfg.compliance.min_review_ms,
      emergency_stop_supported: true,
      automation_bias_monitoring: true,
      subagent_oversight_propagation: true
    },
    accuracy_robustness_cybersecurity: {
      article: "Art. 15",
      alignment_method: "a_star_alignment",
      declare_rules_count: 7,
      transactional_rollback_supported: true,
      max_retries_per_signature: cfg.compliance.max_retries_per_signature,
      kingman_heavy_tail_separation: true,
      standing: "UNVERIFIED"
    },
    record_keeping_and_pmm: {
      articles: ["Art. 12", "Art. 72", "Art. 73"],
      ocel_standard: "IEEE OCEL 2.0 (JSON / SQLite WAL / XML)",
      log_retention_days: cfg.deployer.log_retention_days,
      monitoring_enabled: cfg.deployer.monitoring_enabled,
      drift_alpha: cfg.pmm.drift_alpha,
      min_window: cfg.pmm.min_window,
      k_anonymity: cfg.pmm.k_anonymity
    },
    standing: "UNVERIFIED",
    runtime_standing: "UNVERIFIED",
    alignment_standing: "UNVERIFIED",
    uncertainty_caveats: [
      "No runtime soak logs were evaluated during `zcode compliance info`; standing is reported honestly as UNVERIFIED.",
      "Upstream LLM provider availability, rate limits, and model weights outside zcode-runtime.lock.json can shift output quality; monitor via `zcode pmm analyze`."
    ],
    instructions_for_use_path: "docs/INSTRUCTIONS_FOR_USE.md"
  };
}

export function formatComplianceInfoMarkdown(info: ComplianceInfoReport): string {
  const lines: string[] = [
    "# zcode-cli — EU AI Act Article 13 Instructions for Use & Deployer Info",
    "",
    `- **Regulation**: ${info.regulation}`,
    `- **Distribution**: \`${info.provider.package_name}@${info.provider.package_version}\``,
    `- **Runtime App Version**: \`${info.ai_system.runtime_app_version}\` (CLI \`${info.ai_system.runtime_cli_version}\`)`,
    `- **Runtime Engine Requirement**: Node.js \`${info.ai_system.node_engine_requirement}\``,
    `- **Active Compliance Profile**: \`${info.compliance_profile}\` (high-risk: ${String(info.high_risk)})`,
    `- **Standing**: \`${info.standing}\` (run \`zcode compliance assess --logs <dir>\` to verify over soak logs)`,
    "",
    "## Intended Purpose (Art. 13(3)(b))",
    "",
    info.intended_purpose,
    "",
    "## Prohibited & Out-of-Scope Uses",
    "",
    ...info.prohibited_and_out_of_scope_uses.map((u) => `- ${u}`),
    "",
    "## Human Oversight Controls (Art. 14)",
    "",
    `- **Overseer ID**: \`${info.human_oversight.overseer_id ?? "UNSET"}\``,
    `- **Allow YOLO**: \`${String(info.human_oversight.allow_yolo)}\``,
    `- **Minimum Review Latency**: \`${info.human_oversight.min_review_ms} ms\``,
    `- **Emergency Stop & Subagent Propagation**: enabled`,
    "",
    "## Accuracy, Robustness & Cybersecurity (Art. 15)",
    "",
    `- **Trace Alignment**: \`${info.accuracy_robustness_cybersecurity.alignment_method}\` (optimal synchronous-product A*)`,
    `- **Declare/LTLf Rules**: ${info.accuracy_robustness_cybersecurity.declare_rules_count} mandatory anti-vacuity rules`,
    `- **Per-Signature Retry Cap**: \`${info.accuracy_robustness_cybersecurity.max_retries_per_signature}\``,
    "",
    "## Limitations & Uncertainty Caveats",
    "",
    ...info.limitations_and_constraints.map((l) => `- ${l}`),
    ...info.uncertainty_caveats.map((c) => `- ${c}`),
    "",
    `Full deployer documentation: \`${info.instructions_for_use_path}\``
  ];
  return lines.join("\n") + "\n";
}

export { ComplianceRefusalError };
