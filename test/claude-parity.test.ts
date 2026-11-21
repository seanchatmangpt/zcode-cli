import { describe, expect, test } from "bun:test";
import { normalizeClaudeAgentArgs } from "../src/claude-parity.ts";

describe("normalizeClaudeAgentArgs", () => {
  test("maps --dangerously-skip-permissions to --mode yolo", () => {
    expect(normalizeClaudeAgentArgs(["--dangerously-skip-permissions", "-p", "hello"])).toEqual({
      args: ["--mode", "yolo", "-p", "hello"]
    });
  });

  test("does not override explicit --mode when --dangerously-skip-permissions is passed", () => {
    expect(normalizeClaudeAgentArgs(["--mode", "edit", "--dangerously-skip-permissions"])).toEqual({
      args: ["--mode", "edit"]
    });
  });

  test("maps Claude Code --permission-mode values to zcode --mode", () => {
    expect(normalizeClaudeAgentArgs(["--permission-mode", "bypassPermissions"])).toEqual({
      args: ["--mode", "yolo"]
    });
    expect(normalizeClaudeAgentArgs(["--permission-mode=acceptEdits"])).toEqual({
      args: ["--mode", "edit"]
    });
    expect(normalizeClaudeAgentArgs(["--permission-mode", "plan"])).toEqual({
      args: ["--mode", "build"]
    });
    expect(normalizeClaudeAgentArgs(["--permission-mode=default"])).toEqual({
      args: ["--mode", "build"]
    });
  });

  test("rejects missing or invalid --permission-mode values", () => {
    const missing = normalizeClaudeAgentArgs(["--permission-mode"]);
    expect(missing.error).toContain("--permission-mode requires a mode");

    const invalid = normalizeClaudeAgentArgs(["--permission-mode", "bogus"]);
    expect(invalid.error).toContain("Unsupported --permission-mode value: bogus");
  });

  test("maps --print <prompt> to --prompt <prompt> when no -p/--prompt is present", () => {
    expect(normalizeClaudeAgentArgs(["--print", "fix tests"])).toEqual({
      args: ["--prompt", "fix tests"]
    });
    expect(normalizeClaudeAgentArgs(["--print", "--prompt", "fix tests"])).toEqual({
      args: ["--print", "--prompt", "fix tests"]
    });
  });

  test("stops normalizing after --", () => {
    expect(normalizeClaudeAgentArgs(["--", "--dangerously-skip-permissions"])).toEqual({
      args: ["--", "--dangerously-skip-permissions"]
    });
  });
});
