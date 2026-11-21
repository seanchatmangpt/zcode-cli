/**
 * Minimal glob matcher for adapter write-scope checks.
 * Supports `**`, `*`, and `?` only — no brace expansion.
 */
export function minimatch(path: string, pattern: string): boolean {
  const norm = path.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  return matchParts(norm.split("/"), pat.split("/"), 0, 0);
}

function matchParts(path: string[], pat: string[], pi: number, pj: number): boolean {
  while (pi < path.length && pj < pat.length) {
    const p = pat[pj]!;
    if (p === "**") {
      if (pj === pat.length - 1) return true;
      for (let k = pi; k <= path.length; k += 1) {
        if (matchParts(path, pat, k, pj + 1)) return true;
      }
      return false;
    }
    if (!segMatch(path[pi]!, p)) return false;
    pi += 1;
    pj += 1;
  }
  while (pj < pat.length && pat[pj] === "**") pj += 1;
  return pi === path.length && pj === pat.length;
}

function segMatch(seg: string, pat: string): boolean {
  let i = 0;
  let j = 0;
  let star = -1;
  let match = 0;
  while (i < seg.length) {
    if (j < pat.length && (pat[j] === "?" || pat[j] === seg[i])) {
      i += 1;
      j += 1;
      continue;
    }
    if (j < pat.length && pat[j] === "*") {
      star = j;
      match = i;
      j += 1;
      continue;
    }
    if (star !== -1) {
      j = star + 1;
      match += 1;
      i = match;
      continue;
    }
    return false;
  }
  while (j < pat.length && pat[j] === "*") j += 1;
  return j === pat.length;
}
