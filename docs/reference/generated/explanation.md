# Explaining zcode-cli

## Summary

zcode-cli is a crate with 162 modules and 1327 public items on its code surface.

## Verified snippet

<!-- Snippet slot: code facts only, copied from the code surface. -->

```rust
// packages/zcode-tui/src/attachments.ts :: attachmentSummary
attachmentSummary(attachments: PromptImageAttachment[])
```

## Commentary

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- The surface splits into plugin packages (`@zcode/android-emulator-plugin`,               -->
<!-- `@zcode/ios-simulator-plugin`, `@zcode/browser-use-plugin`) and the root CLI with its     -->
<!-- `bin/zcode.ts` entry. `attachmentSummary` in `packages/zcode-tui/src/attachments.ts` is   -->
<!-- typical of TUI helpers; root scripts (`build`, `sync`, `release:build`, `prepack`) form   -->
<!-- the pipeline that turns this source surface into distributable packages.                  -->
<!-- AGENT-COMMENTARY-END -->
