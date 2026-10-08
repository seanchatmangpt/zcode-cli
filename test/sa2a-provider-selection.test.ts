import { describe, expect, test } from "bun:test";
import { selectCandidateProviders, type CandidateProvider, type ProviderHealthState } from "../src/research-runtime/sa2a/index.ts";
const provider = (id: string): CandidateProvider => ({ id, authority: "none", propose: async (input) => input });
describe("SA2A provider selection", () => {
  test("excludes explicit and unhealthy providers", () => {
    const health = new Map<string, ProviderHealthState>([["bad", { provider: "bad", health: "excluded", failures: 1 }]]);
    expect(selectCandidateProviders([provider("good"), provider("bad"), provider("manual")], health, new Set(["manual"])).map((entry) => entry.id)).toEqual(["good"]);
  });
});
