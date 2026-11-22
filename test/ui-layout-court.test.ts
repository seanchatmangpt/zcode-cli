/**
 * Canonical Appendix E.8 ui-layout-court suite entrypoint.
 *
 * ARD / README / F.3 cite `test/ui-layout-court.test.ts` for:
 *   bun test test/ui-layout-court.test.ts
 *
 * Chicago anti-vacuity (E.8.3: 360-in-320 → exit 1, 18px primary → exit 1,
 * Gestalt ratio + adjacent gap < 8 → exit 1, SUBJECT_MISSING → exit 2,
 * mutant refuse then restore → 1 then 0; plus E.5.1 overlap / WCAG 1.4.12
 * witnesses) lives in `ui-layout-court-chicago.test.ts`.
 * Side-effect import runs those same cases so this path stays the one suite
 * entrypoint without duplicating bodies. Bun ESM cache keeps a broad
 * `test/*.test.ts` run from double-registering when both files are loaded.
 */
import "./ui-layout-court-chicago.test.ts";
