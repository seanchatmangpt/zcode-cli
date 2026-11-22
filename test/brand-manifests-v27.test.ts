import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const CINDYCAT_PATH = join(REPO_ROOT, "brands/cindycat.brand.toml");
const FOURTH_WATCH_PATH = join(REPO_ROOT, "brands/fourth-watch.brand.toml");

type BrandManifest = Record<string, any>;

function loadBrandToml(filePath: string): BrandManifest {
  const raw = readFileSync(filePath, "utf8");
  return Bun.TOML.parse(raw) as BrandManifest;
}

describe("v27.1.1 brand manifests (Gate 2 lock)", () => {
  test("both Fourth Watch and CindyCat brand manifests exist and parse as valid TOML", () => {
    expect(existsSync(FOURTH_WATCH_PATH)).toBe(true);
    expect(existsSync(CINDYCAT_PATH)).toBe(true);

    const fw = loadBrandToml(FOURTH_WATCH_PATH);
    const cc = loadBrandToml(CINDYCAT_PATH);

    expect(fw.brand?.id).toBe("fourth-watch");
    expect(cc.brand?.id).toBe("cindycat");
  });

  test("CindyCat manifest enforces Front Door #2 identity, airlock, and zero-custody commercial invariants", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);

    expect(cc.brand.name).toBe("CindyCat — Her Patronage Restored");
    expect(cc.brand.front_door).toBe("front-door-2");
    expect(cc.brand.ownership).toBe("woman-owned-house");
    expect(cc.brand.intake_airlock).toBe("https://cos.fnox.io/drop/:lease_id");
    expect(cc.brand.intake_policy).toBe("self-serve-airlock-only");
    expect(cc.brand.discovery_calls).toBe(false);

    expect(cc.messaging.commercial.custody_pct).toBe(0);
    expect(cc.messaging.commercial.skimming_pct).toBe(0);
    expect(cc.messaging.commercial.transaction_rent_pct).toBe(0);
    expect(cc.messaging.commercial.tithe_goal_pct).toBe(90);
  });

  test("CindyCat manifest encodes Reverse Gloo, Luke 10:7, Matthew 6:3-4, and IRC §170(f)(8) patronage invariants", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);
    const patronage = cc.messaging.patronage;

    expect(patronage.zero_custody_direct_settlement).toBe(true);
    expect(patronage.embedded_third_party_payer_clause).toBe(true);
    expect(patronage.irs_written_acknowledgment_threshold_usd).toBe(250);
    expect(patronage.irs_statutory_citation).toBe("IRC §170(f)(8)");
    expect(patronage.scripture_anchors).toContain("Luke 10:7");
    expect(patronage.scripture_anchors).toContain("Matthew 6:3-4");
    expect(patronage.reverse_gloo_goal).toBe("90% income tithe is the only goal");
    expect(patronage.spec_ref).toBe("docs/gtm/cindycat-patronage-spec-and-reverse-gloo.md");
  });

  test("CindyCat CTA host is strictly cos.fnox.io (never revops.fnox.io) and body CTA has no external URLs", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);

    expect(cc.messaging.cta.featured_host).toBe("cos.fnox.io");
    expect(cc.messaging.cta.featured_url_template).toBe("https://cos.fnox.io/drop/:lease_id");
    expect(cc.messaging.cta.forbidden_hosts).toContain("revops.fnox.io");
    expect(cc.extensions.honesty.intake_host_of_record).toBe("cos.fnox.io");

    const requiredCta: string = cc.messaging.voice.required_cta;
    expect(requiredCta).not.toMatch(/https?:\/\/|www\./i);
    expect(requiredCta).toContain("cos.fnox.io");
  });

  test("CindyCat redaction_court twin and honesty invariants are fail-closed", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);

    expect(cc.redaction_court).toEqual(cc.messaging.redaction_court);
    expect(cc.redaction_court.forbid_private_client_names).toBe(true);
    expect(cc.redaction_court.forbid_local_user_paths).toBe(true);
    expect(cc.redaction_court.forbid_bearer_tokens).toBe(true);
    expect(cc.redaction_court.forbid_external_links_in_post_body).toBe(true);
    expect(cc.redaction_court.forbid_calendar_links).toBe(true);
    expect(cc.redaction_court.require_public_anonymize).toBe(true);

    expect(cc.extensions.honesty.webgpu_120hz_status).toBe("doc-only-not-shipping");
    expect(cc.extensions.honesty.zero_dom_status).toBe("doc-only-not-shipping");
    expect(cc.extensions.honesty.raid_4cloud_status).toBe("target-not-proven");
  });

  test("CindyCat DTCG typography and touch-target tokens satisfy LinkedIn and Apple HIG floors", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);

    expect(cc.tokens.dtcg.spec_version).toBe("2025.10");
    expect(cc.tokens.dtcg.surface_target).toBe("css-theme-spacing");
    expect(cc.tokens.typography.scale_body_px.value).toBeGreaterThanOrEqual(24);
    expect(cc.tokens.typography.scale_caption_px.value).toBeGreaterThanOrEqual(16);
    expect(cc.tokens.typography.base_min_px.value).toBeGreaterThanOrEqual(16);
    expect(cc.tokens.spacing.touch_target_min_px.value).toBeGreaterThanOrEqual(44);
  });

  test("CindyCat spec_ref resolves to a real Reverse Gloo LinkedIn/DM pack in docs/gtm/", () => {
    const cc = loadBrandToml(CINDYCAT_PATH);
    const specPath = join(REPO_ROOT, cc.messaging.patronage.spec_ref);

    expect(existsSync(specPath)).toBe(true);
    const content = readFileSync(specPath, "utf8");
    expect(content).toMatch(/reverse gloo/i);
    expect(content).toContain("90% income tithe");
    expect(content).toContain("IRC §170(f)(8)");
    expect(content).toContain("Luke 10:7");
    expect(content).toContain("Matthew 6:3-4");
    expect(content).toMatch(/LinkedIn/i);
    expect(content).toMatch(/DM/i);
  });
});
