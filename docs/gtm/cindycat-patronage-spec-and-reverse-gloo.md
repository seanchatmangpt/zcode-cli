# CindyCat — Her Patronage Restored: Patronage Specification & Reverse Gloo Pack

**Brand Manifest:** [`brands/cindycat.brand.toml`](../../brands/cindycat.brand.toml)  
**Front Door:** Front Door #2 — Woman-Owned House (Gate 2 lock deliverable per `docs/ecosystem-spec-27.1.1.md`)  
**Cross-Reference:** [`docs/gtm/year-end-sow-and-3-channel-sla.md`](./year-end-sow-and-3-channel-sla.md)  
**Honesty Fence:** Featured CTA host is `cos.fnox.io` only (never `revops.fnox.io`), SlotLease-gated until live `cos /readyz` 200 ∧ 2× durable LOW-only receipts on disk. No `@fnox/*` GA, 4-Cloud RAID GA, or 120 Hz WebGPU claims.

---

## 1. Ethical & Commercial Invariants

CindyCat operates as the woman-owned civic and church patronage house paired with Fourth Watch AI Cybersecurity:

- **0% Custody:** Neither CindyCat nor FNOX ever holds, pools, escrows, or touches patronage or charitable funds. Zero FinCEN money-transmitter custody.
- **0.00% Skimming (Zero Transaction Rent / Zero *Neshek*):** Zero percentage rake, zero platform spread, zero hidden payment-processing markup.
- **Luke 10:7 Craftsmanship:** Monetization runs strictly on transparent, flat fees for craftsmanship and horizontal engineering—never rent on generosity.
- **Matthew 6:3-4 Quiet Patronage:** No donor leaderboards, no performative charity badges, no vanity naming rights. Patronage settles quietly and deterministically.
- **Reverse Gloo:** Traditional church-tech platforms extract recurring SaaS and payment-processing rent from congregations. Reverse Gloo inverts the flow: **90% income tithe is the only goal**, funding sovereign, client-EIN-owned infrastructure for churches and civic anchors with zero vendor lock-in.

---

## 2. The 3 Patronage Non-Negotiables (Fail-Closed Contract)

Every CindyCat patronage engagement MUST satisfy all three non-negotiables. Absence of any one non-negotiable is a fail-closed `REFUSED` state—no invoice may issue and no patronage tranche may settle.

### Non-Negotiable 1: Zero-Custody Direct-to-Vendor Settlement (Stripe Connect / Direct Invoicing)
- **Mechanism:** Funds move directly from the Patron (or Beneficiary) to the executing vendor/provider via **Stripe Connect direct charges** or **direct-to-vendor ACH/invoicing**.
- **Invariant:** `custody_pct == 0.0` and `skimming_pct == 0.0`. CindyCat is never in the flow of funds and never takes title to patronage capital.
- **Verification:** Settlement receipt MUST record the Stripe Connect `transfer_group` / `charge_id` or direct-invoice wire reference, proving direct patron-to-vendor clearing with zero intermediary ledger custody.

### Non-Negotiable 2: Embedded Third-Party Payer Clause
Every SOW or patronage addendum funded by a third-party patron on behalf of a church or 501(c)(3)/civic beneficiary MUST embed the following binding clause verbatim:

> **Third-Party Payer Clause:**  
> *Provider acknowledges and agrees that fees under this Agreement may be remitted directly to Provider by an authorized third-party patron ("Patron") via direct-to-vendor invoicing or Stripe Connect on behalf of the designated Beneficiary ("Client"). Payment by Patron satisfies Client's payment obligation dollar-for-dollar, confers zero ownership, license, data-access, or governance rights upon Patron over Client's EIN cloud accounts, domain data, or deliverables, and creates no custodial, fiduciary, or money-transmission relationship with CindyCat or Provider. Provider retains 0% custody of non-fee charitable funds and applies 0.00% transaction skimming.*

### Non-Negotiable 3: Automated `>$250` IRS Written Acknowledgment (IRC §170(f)(8))
- **Statutory Trigger:** Any single patronage contribution or direct-to-vendor settlement of **$250 or more (`>= $250` / `>$250` threshold under IRC §170(f)(8))** triggers an automated contemporaneous written acknowledgment issued by the qualified 501(c)(3) / church Beneficiary to the Patron prior to the earlier of the Patron's tax-return filing date or due date (including extensions).
- **Mandatory Fields (Fail-Closed):**
  1. **Beneficiary Identity:** Legal name and EIN of the qualified 501(c)(3) / church recipient.
  2. **Patron Identity & Date:** Patron legal name and exact UTC settlement date.
  3. **Amount / Description:** Exact cash amount settled (or description of non-cash property/services) and direct-to-vendor invoice reference.
  4. **Goods-or-Services Statement (IRC §170(f)(8)(B)(ii)–(iii)):** Explicit statement confirming *"No goods or services were provided by the organization in whole or in part in consideration for this contribution"* (or, if applicable, a good-faith estimate of the value of any goods/services provided, or statement that only intangible religious benefits were provided).
  5. **Cryptographic Receipt Binding:** SHA-256 hash of the acknowledgment artifact linked to the settlement reference for audit replay.

---

## 3. Reverse Gloo — LinkedIn Profile, DM & Post Pack

> **Core Thesis:** *"90% income tithe is the only goal."*  
> **Redaction Court Compliance:** Zero external URLs in post bodies, zero calendar links, zero discovery calls, zero private client names. Featured CTA points exclusively to `/drop/:lease_id` on `cos.fnox.io` (first comment only, SlotLease-gated).

### 3.1 LinkedIn Profile Positioning
- **Headline:**  
  `CindyCat — Her Patronage Restored | 0% Custody · 0.00% Skimming | Sovereign Infrastructure for Churches & Civic Anchors | 90% Income Tithe Is the Only Goal`
- **About Section:**  
  > Most church and civic technology runs on extraction: percentage skims on giving, custodial lock-in, and bloated SaaS subscriptions that drain mission budgets.  
  >  
  > **CindyCat (Her Patronage Restored)** is a woman-owned patronage house built on Reverse Gloo: **90% income tithe is the only goal.**  
  >  
  > We follow three non-negotiables:  
  > 1. **Zero-custody direct-to-vendor settlement** via Stripe Connect or direct invoicing (0% custody, 0.00% skimming — *Luke 10:7*).  
  > 2. **Embedded third-party payer clause** so patrons fund church and civic infrastructure directly without taking control of the church's accounts or data.  
  > 3. **Automated >$250 IRS written acknowledgment (IRC §170(f)(8))** so stewardship stays compliant and quiet (*Matthew 6:3-4*).  
  >  
  > No discovery calls. No donor leaderboards. Drop a read-only packet at Featured `/drop/:lease_id` on `cos.fnox.io`.

### 3.2 Direct Message (DM) Templates

#### DM 1 — Church / Civic Anchor Pastor or Executive Director
> Hi [Name] — reaching out quietly. We run CindyCat (Her Patronage Restored), a woman-owned house that funds sovereign infrastructure for churches with 0% custody and 0.00% skimming. Patrons settle vendor invoices directly via Stripe Connect or direct invoicing under an embedded third-party payer clause, and your church issues automated >$250 IRC §170(f)(8) written acknowledgments automatically. No discovery call needed—if you want to inspect the 1-page patronage addendum, reply "addendum" and I'll send it over.

#### DM 2 — Patron / Family Office Steward
> Hi [Name] — building Reverse Gloo through CindyCat (Her Patronage Restored). Our only goal is a 90% income tithe, executed with Matthew 6:3-4 discretion: 0% custody, 0.00% platform skimming, direct-to-vendor settlement, and automated >$250 IRS written acknowledgments under IRC §170(f)(8). If you fund church or civic infrastructure and want your dollars to clear 100% to the work with zero middleman rent, reply "spec" and I'll share the 1-page patronage contract.

#### DM 3 — Technical Operator / Sovereign Foundry Partner
> Hi [Name] — CindyCat is our Front Door #2 (woman-owned house) for church and civic patronage. Flat craftsmanship fees only (Luke 10:7), 0% custody, 0.00% skimming, and an embedded third-party payer clause so patrons can underwrite client-EIN infrastructure cleanly. Happy to send the patronage spec if you're building for mission-driven anchors.

### 3.3 LinkedIn Post Pack (Body Prose — No External Links)

#### Post 1 — Reverse Gloo: "90% income tithe is the only goal"
> Most church-tech companies ask how much they can extract from a congregation's giving.  
>  
> Reverse Gloo asks the opposite question: how do we strip platform rent down to 0.00% so the church keeps its infrastructure and its mission?  
>  
> For CindyCat (Her Patronage Restored), **90% income tithe is the only goal.**  
>  
> Not a vanity foundation. Not a 2.9% + $0.30 skim dressed up as "ministry software."  
>  
> Three rules, enforced in code and contract:  
> 1. Zero-custody direct-to-vendor settlement (Stripe Connect or direct invoicing).  
> 2. Embedded third-party payer clause protecting the church's sole ownership of its EIN accounts and data.  
> 3. Automated >$250 IRS written acknowledgment under IRC §170(f)(8).  
>  
> Quiet patronage. Matthew 6:3-4.  
>  
> Drop a read-only packet at Featured /drop/:lease_id on cos.fnox.io (link in first comment).

#### Post 2 — Luke 10:7 vs. Platform Skimming
> Luke 10:7 says the worker is worthy of wages. It never says the middleman is worthy of a perpetual percentage skim on generosity.  
>  
> At CindyCat (Her Patronage Restored), we enforce two hard numbers:  
> - **0% custody** — we never hold charitable or patronage funds.  
> - **0.00% skimming** — zero transaction rent, zero hidden spread.  
>  
> Craftsmanship is billed flat and transparently. Patronage settles directly to the vendor under an embedded third-party payer clause.  
>  
> If your church or civic anchor is tired of paying rent on its own generosity, drop a read-only packet at Featured /drop/:lease_id on cos.fnox.io (link in first comment).

#### Post 3 — Matthew 6:3-4 and the Automated >$250 Receipt
> Quiet patronage shouldn't fail an IRS audit.  
>  
> Matthew 6:3-4 calls for giving without fanfare—no donor walls, no gala plaques, no public scoreboards.  
>  
> At the same time, IRC §170(f)(8) requires a contemporaneous written acknowledgment for every contribution of $250 or more.  
>  
> CindyCat (Her Patronage Restored) automates the >$250 written acknowledgment directly from the direct-to-vendor settlement record—binding the beneficiary EIN, exact amount, date, and explicit goods-or-services statement into a deterministic receipt.  
>  
> Zero custody. Zero skimming. Quiet stewardship that stands up to scrutiny.  
>  
> Featured /drop/:lease_id on cos.fnox.io (link in first comment).
