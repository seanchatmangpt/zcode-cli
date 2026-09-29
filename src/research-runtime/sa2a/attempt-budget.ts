export class AttemptBudget {
  #remaining: number;
  constructor(limit: number) { this.#remaining = Math.max(0, Math.floor(limit)); }
  get remaining(): number { return this.#remaining; }
  consume(): boolean { if (this.#remaining <= 0) return false; this.#remaining -= 1; return true; }
}
