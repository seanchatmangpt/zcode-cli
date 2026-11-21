import {
  truncateToWidth,
  visibleWidth,
  type Component
} from "@earendil-works/pi-tui";

import { sanitizeTerminalText, wrapTerminalText } from "./terminal-text.ts";
import type { ZCodeTheme } from "./theme.ts";

/** A terminal interpretation of the split, diagonal Z in the Desktop app icon. */
export const BRAND_MARK: readonly string[] = [
  "█████ ▄███",
  "    ▄██▀  ",
  "  ▄██▀    ",
  "▄███ █████"
];

export const BRAND_MARK_WIDTH = 10;
export const WIDE_BANNER_MIN_WIDTH = 48;

const maxInformationWidth = 52;
const boxTitle = "── SYSTEM INITIATED ";
const DEFAULT_ART50_NOTICE =
  "AI System (EU AI Act Art. 50): Interacting with an AI coding agent";

export interface WelcomeBannerOptions {
  branch?: string;
  distributionVersion?: string;
  runtimeVersion: string;
  workspace: string;
  complianceProfile?: string;
  provider?: string;
  model?: string;
  aiDisclosure?: boolean;
  disclosureText?: string;
}

function bannerText(value: string): string {
  return sanitizeTerminalText(value, { preserveSgr: false }).replace(/\s+/gu, " ").trim();
}

function truncateFromStart(value: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(value) <= width) return value;
  if (width === 1) return "…";
  const suffix: string[] = [];
  for (const character of Array.from(value).reverse()) {
    const candidate = `${character}${suffix.join("")}`;
    if (visibleWidth(`…${candidate}`) > width) break;
    suffix.unshift(character);
  }
  return `…${suffix.join("")}`;
}

function padTerminalText(value: string, width: number): string {
  const truncated = truncateToWidth(value, Math.max(0, width), "…");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function boxRule(prefix: "┌" | "└", width: number): string {
  const content = prefix === "┌" ? boxTitle : "";
  return `${prefix}${content}${"─".repeat(Math.max(0, width - 1 - visibleWidth(content)))}`;
}

export class WelcomeBanner implements Component {
  private readonly branch?: string;
  private readonly distributionVersion?: string;
  private readonly runtimeVersion: string;
  private readonly workspace: string;
  private readonly complianceProfile?: string;
  private readonly provider?: string;
  private readonly model?: string;
  private readonly disclosureText?: string;
  private readonly showDisclosure: boolean;

  constructor(
    private readonly theme: ZCodeTheme,
    options: WelcomeBannerOptions
  ) {
    this.branch = options.branch
      ? bannerText(options.branch)
      : undefined;
    this.distributionVersion = options.distributionVersion
      ? bannerText(options.distributionVersion)
      : undefined;
    this.runtimeVersion = bannerText(options.runtimeVersion);
    this.workspace = bannerText(options.workspace);
    this.complianceProfile = options.complianceProfile
      ? bannerText(options.complianceProfile)
      : undefined;
    this.provider = options.provider
      ? bannerText(options.provider)
      : undefined;
    this.model = options.model
      ? bannerText(options.model)
      : undefined;
    this.disclosureText = options.disclosureText
      ? bannerText(options.disclosureText)
      : undefined;

    const hasComplianceInput =
      options.aiDisclosure !== undefined ||
      options.complianceProfile !== undefined ||
      options.provider !== undefined ||
      options.model !== undefined ||
      options.disclosureText !== undefined;
    const regulated =
      this.complianceProfile !== undefined && this.complianceProfile !== "standard";
    this.showDisclosure =
      hasComplianceInput && (regulated || options.aiDisclosure !== false);
  }

  render(width: number): string[] {
    if (width <= 0) return [""];
    return width >= WIDE_BANNER_MIN_WIDTH
      ? this.renderWide(width)
      : this.renderCompact(width);
  }

  invalidate(): void {}

  private disclosureLines(width: number): string[] {
    if (!this.showDisclosure) return [];
    const base = this.disclosureText || DEFAULT_ART50_NOTICE;
    const modelTag = [this.provider, this.model].filter(Boolean).join("/");
    const profileTag = this.complianceProfile
      ? `profile ${this.complianceProfile}`
      : undefined;
    const rawNotice = [base, modelTag, profileTag].filter(Boolean).join(" · ");
    const contentWidth = Math.max(1, width - 1);
    const wrapped = wrapTerminalText(rawNotice, contentWidth);
    return wrapped.map((line, index) => {
      const styled = index === 0 ? this.theme.warning(line) : this.theme.muted(line);
      return truncateToWidth(` ${styled}`, width, "…");
    });
  }

  private renderWide(width: number): string[] {
    const contentWidth = Math.max(1, width - 1);
    const gap = "   ";
    const informationWidth = Math.max(1, contentWidth - BRAND_MARK_WIDTH - gap.length);
    const panelWidth = Math.min(informationWidth, maxInformationWidth);
    const panelContentWidth = Math.max(1, panelWidth - 2);
    const primaryVersion = this.distributionVersion ?? this.runtimeVersion;
    const identity = `${this.theme.bold(this.theme.accent("ZCODE"))}  ${this.theme.muted(`v${primaryVersion}`)}`;
    const fullVersionLine = this.distributionVersion
      ? `${identity}${this.theme.muted(` · runtime v${this.runtimeVersion}`)}`
      : identity;
    const compactVersionLine = this.distributionVersion
      ? `${identity}${this.theme.muted(` · rt v${this.runtimeVersion}`)}`
      : identity;
    const versionLine = visibleWidth(fullVersionLine) <= panelContentWidth
      ? fullVersionLine
      : compactVersionLine;
    const locationLine = this.locationLine(panelContentWidth);
    const information = [
      this.theme.muted(boxRule("┌", panelWidth)),
      `${this.theme.muted("│")} ${padTerminalText(versionLine, panelContentWidth)}`,
      `${this.theme.muted("│")} ${this.theme.muted(padTerminalText(locationLine, panelContentWidth))}`,
      this.theme.muted(boxRule("└", panelWidth))
    ];

    const brandLines = BRAND_MARK.map((line, index) => (
      ` ${this.theme.accent(line)}${gap}${information[index] ?? ""}`
    ));
    return [...brandLines, ...this.disclosureLines(width)];
  }

  private locationLine(width: number): string {
    if (!this.branch) return truncateFromStart(this.workspace, width);
    const separator = " · ";
    const branchWidth = Math.max(8, Math.min(
      visibleWidth(`branch ${this.branch}`),
      Math.floor(width * 0.45)
    ));
    const branch = truncateToWidth(`branch ${this.branch}`, branchWidth, "…");
    const workspaceWidth = width - visibleWidth(separator) - visibleWidth(branch);
    if (workspaceWidth < 4) return truncateToWidth(branch, width, "…");
    return `${truncateFromStart(this.workspace, workspaceWidth)}${separator}${branch}`;
  }

  private renderCompact(width: number): string[] {
    const contentWidth = Math.max(0, width - 1);
    const primaryVersion = this.distributionVersion ?? this.runtimeVersion;
    const identity = `${this.theme.bold(this.theme.accent("ZCODE"))}  ${this.theme.muted(`v${primaryVersion}`)}`;
    const location = [this.workspace, this.branch ? `branch ${this.branch}` : undefined]
      .filter((value): value is string => Boolean(value))
      .join(" · ");
    const baseLines = [
      ` ${truncateToWidth(identity, contentWidth)}`,
      ` ${this.theme.muted(truncateFromStart(location, contentWidth))}`
    ];
    return [...baseLines, ...this.disclosureLines(width)];
  }
}

/** A quiet full-width rule separating startup identity from the conversation. */
export class Divider implements Component {
  constructor(
    private readonly char: string,
    private readonly style: (text: string) => string
  ) {}

  render(width: number): string[] {
    if (width <= 0) return [""];
    const baseWidth = Math.max(0, width - 1);
    if (baseWidth < 8) {
      return [` ${this.style(this.char.repeat(baseWidth))}`];
    }
    const prefix = `${this.char.repeat(3)}◆`;
    const suffix = this.char.repeat(Math.max(0, baseWidth - visibleWidth(prefix)));
    return [` ${this.style(truncateToWidth(prefix + suffix, baseWidth))}`];
  }

  invalidate(): void {}
}
