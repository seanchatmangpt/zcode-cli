import type { Sa2aReplanEnvelope } from "./contract.js";

export interface CandidateProvider {
  readonly id: string;
  readonly authority: "none";
  propose(input: Sa2aReplanEnvelope): Promise<Sa2aReplanEnvelope>;
}

export class CandidateProviderRegistry {
  readonly #providers = new Map<string, CandidateProvider>();

  register(provider: CandidateProvider): void {
    if (provider.authority !== "none") throw new Error("SA2A_PROVIDER_AUTHORITY_REFUSED");
    if (!provider.id) throw new Error("SA2A_PROVIDER_ID_REQUIRED");
    this.#providers.set(provider.id, provider);
  }

  get(id: string): CandidateProvider | undefined {
    return this.#providers.get(id);
  }

  excluding(ids: ReadonlySet<string>): CandidateProvider[] {
    return [...this.#providers.values()].filter((provider) => !ids.has(provider.id));
  }
}
