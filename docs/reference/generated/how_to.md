# How to: Using zcode-cli

## Prerequisites


- @zcode/android-emulator-plugin::android-emulator-mcp (bin)

- @zcode/android-emulator-plugin::build (script)

- @zcode/android-emulator-plugin::clean (script)

- @zcode/android-emulator-plugin::test (script)

- @zcode/android-emulator-plugin::typecheck (script)

- @zcode/browser-use-plugin::build (script)

- @zcode/browser-use-plugin::clean (script)

- @zcode/browser-use-plugin::lint (script)

- @zcode/browser-use-plugin::test (script)

- @zcode/browser-use-plugin::typecheck (script)

- @zcode/ios-simulator-plugin::build (script)

- @zcode/ios-simulator-plugin::clean (script)

- @zcode/ios-simulator-plugin::ios-simulator-mcp (bin)

- @zcode/ios-simulator-plugin::test (script)

- @zcode/ios-simulator-plugin::typecheck (script)

- @zcode/node-repl-host::build (script)

- @zcode/node-repl-host::lint (script)

- @zcode/node-repl-host::test (script)

- @zcode/node-repl-host::typecheck (script)

- @zcode/plugin-creator-plugin::test (script)

- @zcode/plugin-creator-plugin::test:integration (script)

- @zcode/zcode-cua-plugin::build (script)

- @zcode/zcode-cua-plugin::bump:producer (script)

- @zcode/zcode-cua-plugin::check:baseline (script)

- @zcode/zcode-cua-plugin::clean (script)

- @zcode/zcode-cua-plugin::sync:all (script)

- @zcode/zcode-cua-plugin::sync:cache (script)

- @zcode/zcode-cua-plugin::sync:skill (script)

- @zcode/zcode-cua-plugin::sync:version (script)

- @zcode/zcode-cua-plugin::test (script)

- @zcode/zcode-cua-plugin::typecheck (script)

- @zcode/zcode-cua-plugin::version:check (script)

- packages/zcode-tui/src/assistant-stream.ts::AssistantStream (class)

- packages/zcode-tui/src/assistant-stream.ts::append (method)

- packages/zcode-tui/src/assistant-stream.ts::beginTurn (method)

- packages/zcode-tui/src/assistant-stream.ts::breakSegment (method)

- packages/zcode-tui/src/assistant-stream.ts::clear (method)

- packages/zcode-tui/src/assistant-stream.ts::ensurePartSegment (method)

- packages/zcode-tui/src/assistant-stream.ts::reconcile (method)

- packages/zcode-tui/src/assistant-stream.ts::removePart (method)


## Steps


1. Use `android-emulator-mcp` from `@zcode/android-emulator-plugin`.

2. Use `build` from `@zcode/android-emulator-plugin`.

3. Use `clean` from `@zcode/android-emulator-plugin`.

4. Use `test` from `@zcode/android-emulator-plugin`.

5. Use `typecheck` from `@zcode/android-emulator-plugin`.

6. Use `build` from `@zcode/browser-use-plugin`.

7. Use `clean` from `@zcode/browser-use-plugin`.

8. Use `lint` from `@zcode/browser-use-plugin`.

9. Use `test` from `@zcode/browser-use-plugin`.

10. Use `typecheck` from `@zcode/browser-use-plugin`.

11. Use `ios-simulator-mcp` from `@zcode/ios-simulator-plugin`.

12. Use `build` from `@zcode/ios-simulator-plugin`.


## Verified snippet

<!-- The snippet slot carries code copied from the extracted code surface -->
<!-- (doc:Claim rows whose doc:attribute is "snippet"), never agent prose. -->

```rust
// packages/zcode-tui/src/attachments.ts :: attachmentSummary
attachmentSummary(attachments: PromptImageAttachment[])
```

<!-- AGENT-COMMENTARY-BEGIN -->
<!-- `run` and `build` are npm scripts on the root surface; `test:tui`, `test:unit`, and      -->
<!-- `test:runtime` partition the suite. The two `bin` entries, `android-emulator-mcp` and     -->
<!-- `ios-simulator-mcp`, come from the `@zcode/android-emulator-plugin` and                   -->
<!-- `@zcode/ios-simulator-plugin` packages. The `sync` and `sync:local` scripts rebuild and   -->
<!-- mirror runtime bits; `verify:tui-perf` and `receipts:validate` guard the release path.    -->
<!-- AGENT-COMMENTARY-END -->
