/**
 * Claude Code CLI agent parity normalization.
 *
 * Translates common Claude Code headless/agent CLI flags into their native
 * ZCode runtime equivalents before `inspectRuntimeInvocation` / `runRuntime`.
 * Unknown flags are left untouched so the runtime CLI remains the authority.
 */

export interface ClaudeParityResult {
  args: string[];
  error?: string;
}

const PERMISSION_MODE_MAP: Readonly<Record<string, "build" | "edit" | "yolo">> = {
  build: "build",
  default: "build",
  plan: "build",
  edit: "edit",
  acceptEdits: "edit",
  yolo: "yolo",
  bypassPermissions: "yolo",
  dontAsk: "yolo"
};

function hasExplicitMode(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--") break;
    if (a === "--mode" || a.startsWith("--mode=")) return true;
  }
  return false;
}

function hasExplicitPrompt(args: readonly string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--") break;
    if (a === "-p" || a === "--prompt" || a.startsWith("--prompt=") || (a.startsWith("-p") && a.length > 2)) {
      return true;
    }
  }
  return false;
}

export function normalizeClaudeAgentArgs(args: string[]): ClaudeParityResult {
  const out: string[] = [];
  const explicitMode = hasExplicitMode(args);
  const explicitPrompt = hasExplicitPrompt(args);
  let injectedMode = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--") {
      out.push(...args.slice(i));
      break;
    }

    if (a === "--dangerously-skip-permissions") {
      if (!explicitMode && !injectedMode) {
        out.push("--mode", "yolo");
        injectedMode = true;
      }
      continue;
    }

    if (a === "--permission-mode" || a.startsWith("--permission-mode=")) {
      const inline = a.startsWith("--permission-mode=");
      const raw = inline ? a.slice("--permission-mode=".length) : args[i + 1];
      if (!inline) i += 1;
      if (!raw || raw.startsWith("-")) {
        return {
          args,
          error: "--permission-mode requires a mode (default, plan, acceptEdits, bypassPermissions, dontAsk, build, edit, yolo)"
        };
      }
      const mapped = PERMISSION_MODE_MAP[raw];
      if (!mapped) {
        return {
          args,
          error: `Unsupported --permission-mode value: ${raw}`
        };
      }
      if (!explicitMode && !injectedMode) {
        out.push("--mode", mapped);
        injectedMode = true;
      }
      continue;
    }

    if (a === "--print" && !explicitPrompt) {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        out.push("--prompt", next);
        i += 1;
        continue;
      }
    }

    out.push(a);
  }

  return { args: out };
}
