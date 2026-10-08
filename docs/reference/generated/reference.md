# zcode-cli reference

<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-BEGIN: reference body is RIGID                -->
<!-- Every row below is rendered from queries/ast_extract.rq.      -->
<!-- Agents MUST NOT add, edit, reorder, or remove any row or      -->
<!-- table cell. Prose outside the fenced slot below is refused    -->
<!-- by the doc_quality court.                                     -->
<!-- ============================================================= -->

## Modules


### @zcode/android-emulator-plugin

| `android-emulator-mcp` | bin | ./dist/mcp/server.js |  |  |  |  |

| `build` | script | tsc && node scripts/build-mcp.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |


### @zcode/browser-use-plugin

| `build` | script | tsc && node scripts/build.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `lint` | script | oxlint src --no-ignore |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |


### @zcode/ios-simulator-plugin

| `ios-simulator-mcp` | bin | ./dist/mcp/server.js |  |  |  |  |

| `build` | script | tsc && node scripts/build-mcp.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |


### @zcode/node-repl-host

| `build` | script | tsc && node scripts/build.mjs |  |  |  |  |

| `lint` | script | oxlint src --no-ignore |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |


### @zcode/plugin-creator-plugin

| `test` | script | node --test test/*.test.mjs |  |  |  |  |

| `test:integration` | script | node test/dev-workflow.integration.mjs ../cli/dist/zcode.cjs |  |  |  |  |


### @zcode/zcode-cua-plugin

| `build` | script | node scripts/check-sdk.mjs |  |  |  |  |

| `bump:producer` | script | node scripts/bump-zcode-cua-producer.mjs |  |  |  |  |

| `check:baseline` | script | node scripts/check-cua-baseline.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `sync:all` | script | pnpm sync:skill && pnpm sync:version && pnpm build && pnpm sync:cache |  |  |  |  |

| `sync:cache` | script | node scripts/sync-cache.mjs |  |  |  |  |

| `sync:skill` | script | node scripts/sync-skill-from-zcode-cua.mjs |  |  |  |  |

| `sync:version` | script | node scripts/check-version-coherence.mjs |  |  |  |  |

| `test` | script | pnpm run build && node --test tests/*.node-test.mjs |  |  |  |  |

| `typecheck` | script | node scripts/check-sdk.mjs |  |  |  |  |

| `version:check` | script | node scripts/check-version-coherence.mjs --check |  |  |  |  |


### packages/zcode-tui/src/assistant-stream.ts

| `AssistantStream` | class | class AssistantStream |  |  |  |  |

| `append` | method | append(delta: string, partId?: string, messageId?: string) |  |  |  |  |

| `beginTurn` | method | beginTurn() |  |  |  |  |

| `breakSegment` | method | breakSegment() |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `ensurePartSegment` | method | ensurePartSegment(partId: string, messageId?: string) |  |  |  |  |

| `reconcile` | method | reconcile(response: string) |  |  |  |  |

| `removePart` | method | removePart(partId: string) |  |  |  |  |

| `upsert` | method | upsert(text: string, partId: string, messageId?: string) |  |  |  |  |


### packages/zcode-tui/src/attachment-bar.ts

| `AttachmentBar` | class | class AttachmentBar |  |  |  |  |

| `AttachmentBarCallbacks` | interface | interface AttachmentBarCallbacks |  |  |  |  |

| `activate` | method | activate(index = this.attachments.length - 1) |  |  |  |  |

| `compactLine` | method | compactLine(width: number) |  |  |  |  |

| `deactivate` | method | deactivate() |  |  |  |  |

| `getSelectedIndex` | method | getSelectedIndex() |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isActive` | method | isActive() |  |  |  |  |

| `moveSelection` | method | moveSelection(delta: -1 | 1) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setAttachments` | method | setAttachments(attachments: PromptImageAttachment[]) |  |  |  |  |

| `token` | method | token(index: number) |  |  |  |  |

| `withInactiveHint` | method | withInactiveHint(line: string, width: number) |  |  |  |  |


### packages/zcode-tui/src/attachments.ts

| `attachmentSummary` | function | attachmentSummary(attachments: PromptImageAttachment[]) |  |  |  |  |

| `clipboardImageAttachment` | function | clipboardImageAttachment(value: unknown) |  |  |  |  |

| `promptInput` | function | promptInput(text: string, attachments: PromptImageAttachment[]) |  |  |  |  |

| `PromptImageAttachment` | interface | interface PromptImageAttachment |  |  |  |  |


### packages/zcode-tui/src/background-task-events.ts

| `BackgroundTaskEventStore` | class | class BackgroundTaskEventStore |  |  |  |  |

| `TaskActivityEntry` | interface | interface TaskActivityEntry |  |  |  |  |

| `TaskEventNotice` | interface | interface TaskEventNotice |  |  |  |  |

| `TaskEventUpdate` | interface | interface TaskEventUpdate |  |  |  |  |

| `appendHandoffDelta` | method | appendHandoffDelta(taskId: string, turnId: string, delta: string) |  |  |  |  |

| `claim` | method | claim(eventId: string) |  |  |  |  |

| `claimTerminalNotice` | method | claimTerminalNotice(taskId: string, status: string) |  |  |  |  |

| `entries` | method | entries(taskId: string) |  |  |  |  |

| `handle` | method | handle(event: StreamEvent) |  |  |  |  |

| `hasActiveHandoffs` | method | hasActiveHandoffs() |  |  |  |  |

| `isBackgroundToolScoped` | method | isBackgroundToolScoped(event: StreamEvent) |  |  |  |  |

| `isTaskScoped` | method | isTaskScoped(event: StreamEvent) |  |  |  |  |

| `record` | method | record(taskId: string, kind: TaskActivityKind, text: string, turnId?: string) |  |  |  |  |

| `recordSystemMessage` | method | recordSystemMessage(taskId: string, message: string, failed = false) |  |  |  |  |

| `recordUserMessage` | method | recordUserMessage(taskId: string, message: string) |  |  |  |  |

| `rememberScopedTool` | method | rememberScopedTool(event: StreamEvent) |  |  |  |  |

| `rememberScopedToolCall` | method | rememberScopedToolCall(toolCallId: string) |  |  |  |  |

| `rememberScopedTurn` | method | rememberScopedTurn(turnId: string) |  |  |  |  |

| `rememberToolParent` | method | rememberToolParent(toolCallId: string, parentToolCallId: string) |  |  |  |  |

| `retain` | method | retain(taskId: string, entries: TaskActivityEntry[]) |  |  |  |  |

| `scopedTool` | method | scopedTool(toolCallId: string) |  |  |  |  |

| `settleActiveHandoffs` | method | settleActiveHandoffs() |  |  |  |  |

| `TaskActivityKind` | type | type TaskActivityKind |  |  |  |  |


### packages/zcode-tui/src/background-task-output.ts

| `BackgroundTaskOutput` | interface | interface BackgroundTaskOutput |  |  |  |  |


### packages/zcode-tui/src/bounded-tool-text.ts

| `BoundedToolText` | class | class BoundedToolText |  |  |  |  |

| `MAX_ACTIVE_TOOL_TEXT_CHARACTERS` | const | MAX_ACTIVE_TOOL_TEXT_CHARACTERS |  |  |  |  |

| `toolTextValue` | function | toolTextValue(value: string | BoundedToolText | undefined) |  |  |  |  |

| `append` | method | append(delta: string) |  |  |  |  |

| `appendTail` | method | appendTail(delta: string) |  |  |  |  |

| `beginTruncation` | method | beginTruncation(delta: string) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `isTruncated` | method | isTruncated() |  |  |  |  |

| `materializeTail` | method | materializeTail() |  |  |  |  |

| `omittedCharacters` | method | omittedCharacters() |  |  |  |  |

| `output` | method | output() |  |  |  |  |

| `replace` | method | replace(value: string) |  |  |  |  |

| `retainedCharacters` | method | retainedCharacters() |  |  |  |  |

| `toJSON` | method | toJSON() |  |  |  |  |

| `toString` | method | toString() |  |  |  |  |

| `totalCharacters` | method | totalCharacters() |  |  |  |  |

| `value` | method | value() |  |  |  |  |


### packages/zcode-tui/src/choice-dialog.ts

| `ChoiceItem` | interface | interface ChoiceItem |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `scrollContent` | method | scrollContent(delta: number) |  |  |  |  |

| `setSelectionPreview` | method | setSelectionPreview(preview: Component | undefined) |  |  |  |  |

| `updateFilter` | method | updateFilter(filter: string) |  |  |  |  |


### packages/zcode-tui/src/code-highlighter.ts

| `CodeHighlighter` | class | class CodeHighlighter |  |  |  |  |

| `ACTIVE_TYPESCRIPT_HIGHLIGHT_MAX_CHARACTERS` | const | ACTIVE_TYPESCRIPT_HIGHLIGHT_MAX_CHARACTERS |  |  |  |  |

| `CODE_HIGHLIGHT_CACHE_MAX_CHARACTERS` | const | CODE_HIGHLIGHT_CACHE_MAX_CHARACTERS |  |  |  |  |

| `CODE_HIGHLIGHT_CACHE_MAX_ENTRIES` | const | CODE_HIGHLIGHT_CACHE_MAX_ENTRIES |  |  |  |  |

| `isIncrementalTypescriptSource` | function | isIncrementalTypescriptSource(source: string) |  |  |  |  |

| `isLineLocalScript` | function | isLineLocalScript(source: string) |  |  |  |  |

| `isSingleFunctionScriptHeader` | function | isSingleFunctionScriptHeader(source: string) |  |  |  |  |

| `isSingleOpenScriptFunction` | function | isSingleOpenScriptFunction(source: string) |  |  |  |  |

| `languageForFilename` | function | languageForFilename(filePath: string) |  |  |  |  |

| `activeSize` | method | activeSize(source: string, lines: readonly string[]) |  |  |  |  |

| `cacheResult` | method | cacheResult(key: string, lines: string[]) |  |  |  |  |

| `highlight` | method | highlight(code: string, language?: string) |  |  |  |  |

| `highlightFileLine` | method | highlightFileLine(code: string, filePath: string) |  |  |  |  |

| `highlightSource` | method | highlightSource(source: string, language: string) |  |  |  |  |

| `highlightTypescriptStream` | method | highlightTypescriptStream(source: string) |  |  |  |  |

| `isEnabled` | method | isEnabled() |  |  |  |  |

| `promoteActiveTypescript` | method | promoteActiveTypescript() |  |  |  |  |

| `retainIncrementalTypescript` | method | retainIncrementalTypescript(active: IncrementalTypescriptHighlight) |  |  |  |  |

| `setColorScheme` | method | setColorScheme(colorScheme: ZCodeColorScheme) |  |  |  |  |

| `typescriptBlockCandidate` | method | typescriptBlockCandidate(source: string) |  |  |  |  |

| `typescriptLineCandidate` | method | typescriptLineCandidate(source: string) |  |  |  |  |

| `typescriptTopLevelCandidate` | method | typescriptTopLevelCandidate(source: string) |  |  |  |  |


### packages/zcode-tui/src/color-scheme.ts

| `colorSchemeFromColorFgBg` | function | colorSchemeFromColorFgBg(value = process.env.COLORFGBG) |  |  |  |  |

| `colorSchemeFromRgb` | function | colorSchemeFromRgb(color: RgbColor) |  |  |  |  |

| `themePreference` | function | themePreference(value: unknown) |  |  |  |  |

| `RgbColor` | interface | interface RgbColor |  |  |  |  |

| `ZCodeColorScheme` | type | type ZCodeColorScheme |  |  |  |  |

| `ZCodeThemePreference` | type | type ZCodeThemePreference |  |  |  |  |


### packages/zcode-tui/src/context-breakdown.ts

| `estimateTranscriptContextBreakdown` | function | estimateTranscriptContextBreakdown(value: unknown) |  |  |  |  |


### packages/zcode-tui/src/context-cache.ts

| `findActiveBranchMessageIds` | function | findActiveBranchMessageIds(value: unknown) |  |  |  |  |

| `ContextCacheSummary` | interface | interface ContextCacheSummary |  |  |  |  |

| `ContextCacheTrend` | interface | interface ContextCacheTrend |  |  |  |  |

| `ContextCacheTurn` | interface | interface ContextCacheTurn |  |  |  |  |

| `ContextCacheTurnState` | type | type ContextCacheTurnState |  |  |  |  |


### packages/zcode-tui/src/context-status-view.ts

| `ContextDetailView` | class | class ContextDetailView |  |  |  |  |

| `StatusDetailView` | class | class StatusDetailView |  |  |  |  |

| `ContextDetailRefreshData` | interface | interface ContextDetailRefreshData |  |  |  |  |

| `StatusDetailData` | interface | interface StatusDetailData |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderComposition` | method | renderComposition(width: number) |  |  |  |  |

| `renderOverview` | method | renderOverview(width: number) |  |  |  |  |

| `renderTrend` | method | renderTrend(width: number) |  |  |  |  |

| `setData` | method | setData(usage: RuntimeContextUsage | undefined, trend: ContextCacheTrend | undefined) |  |  |  |  |


### packages/zcode-tui/src/diff-browser.ts

| `DiffDetailPage` | class | class DiffDetailPage |  |  |  |  |

| `diffFileDescription` | function | diffFileDescription(file: FileDiffData) |  |  |  |  |

| `DiffBrowserSource` | interface | interface DiffBrowserSource |  |  |  |  |

| `allLines` | method | allLines(width: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `pageCount` | method | pageCount(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |


### packages/zcode-tui/src/events.ts

| `historyText` | function | historyText(value: unknown) |  |  |  |  |

| `isModelCancellationEvent` | function | isModelCancellationEvent(event: StreamEvent) |  |  |  |  |

| `isToolCancellation` | function | isToolCancellation(value: unknown) |  |  |  |  |

| `modelLabel` | function | modelLabel(value: unknown) |  |  |  |  |

| `normalizeEvent` | function | normalizeEvent(value: unknown) |  |  |  |  |

| `normalizeRestoredPart` | function | normalizeRestoredPart(value: unknown) |  |  |  |  |

| `responseText` | function | responseText(value: unknown) |  |  |  |  |

| `restoredMessages` | function | restoredMessages(value: unknown) |  |  |  |  |

| `PartIdentity` | interface | interface PartIdentity |  |  |  |  |

| `RestoredMessage` | interface | interface RestoredMessage |  |  |  |  |

| `StreamEvent` | interface | interface StreamEvent |  |  |  |  |

| `RestoredPart` | type | type RestoredPart |  |  |  |  |


### packages/zcode-tui/src/exit-summary.ts

| `buildExitSummary` | function | buildExitSummary(options: ExitSummaryOptions) |  |  |  |  |

| `formatTokenUsage` | function | formatTokenUsage(metrics: SessionMetrics) |  |  |  |  |

| `resumeCommand` | function | resumeCommand(sessionId?: string) |  |  |  |  |

| `ExitSummary` | interface | interface ExitSummary |  |  |  |  |

| `ExitSummaryOptions` | interface | interface ExitSummaryOptions |  |  |  |  |


### packages/zcode-tui/src/file-diff-budget.ts

| `FILE_DIFF_RETENTION_LIMITS` | const | FILE_DIFF_RETENTION_LIMITS |  |  |  |  |

| `MAX_RETAINED_DIFF_CHARACTERS` | const | MAX_RETAINED_DIFF_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_DIFF_FILES` | const | MAX_RETAINED_DIFF_FILES |  |  |  |  |

| `MAX_RETAINED_DIFF_LINES` | const | MAX_RETAINED_DIFF_LINES |  |  |  |  |

| `fileDiffRetentionSize` | function | fileDiffRetentionSize(diffs: readonly FileDiffData[]) |  |  |  |  |

| `FileDiffRetentionLimits` | interface | interface FileDiffRetentionLimits |  |  |  |  |

| `FileDiffRetentionSize` | interface | interface FileDiffRetentionSize |  |  |  |  |


### packages/zcode-tui/src/file-diff-view.ts

| `FileDiffView` | class | class FileDiffView |  |  |  |  |

| `fileDiffCard` | function | fileDiffCard(options: FileDiffViewOptions, width = 80) |  |  |  |  |

| `fileDiffsForPermission` | function | fileDiffsForPermission(name: string, input: unknown) |  |  |  |  |

| `isFileMutationTool` | function | isFileMutationTool(name: string) |  |  |  |  |

| `FileDiffData` | interface | interface FileDiffData |  |  |  |  |

| `FileDiffHunk` | interface | interface FileDiffHunk |  |  |  |  |

| `FileDiffViewOptions` | interface | interface FileDiffViewOptions |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderHeader` | method | renderHeader(diff: FileDiffData, index: number, width: number) |  |  |  |  |

| `renderHunkHeader` | method | renderHunkHeader(hunk: FileDiffHunk, digits: number, width: number) |  |  |  |  |


### packages/zcode-tui/src/footer-bar.ts

| `FooterBar` | class | class FooterBar |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setContent` | method | setContent(left: string, right?: string, compactRight?: string) |  |  |  |  |


### packages/zcode-tui/src/fullscreen-header.ts

| `FullscreenHeader` | class | class FullscreenHeader |  |  |  |  |

| `SessionWelcome` | class | class SessionWelcome |  |  |  |  |

| `displayWorkspacePath` | function | displayWorkspacePath(workspace: string, homeDirectory = homedir() |  |  |  |  |

| `FullscreenHeaderOptions` | interface | interface FullscreenHeaderOptions |  |  |  |  |

| `SessionWelcomeOptions` | interface | interface SessionWelcomeOptions |  |  |  |  |

| `getPhase` | method | getPhase() |  |  |  |  |

| `identity` | method | identity(width: number, includeVersion = true) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `location` | method | location(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setIncludeIdentity` | method | setIncludeIdentity(include: boolean) |  |  |  |  |

| `setLoginRequired` | method | setLoginRequired(required: boolean) |  |  |  |  |

| `setPhase` | method | setPhase(phase: FullscreenHeaderPhase) |  |  |  |  |

| `setTransitioning` | method | setTransitioning(transitioning: boolean) |  |  |  |  |

| `FullscreenHeaderPhase` | type | type FullscreenHeaderPhase |  |  |  |  |


### packages/zcode-tui/src/goal-status.ts

| `formatTokens` | function | formatTokens(value: number) |  |  |  |  |

| `goalStatusLabel` | function | goalStatusLabel(goal: GoalState | undefined) |  |  |  |  |

| `goalStatusText` | function | goalStatusText(goal: GoalState | undefined) |  |  |  |  |

| `normalizeGoal` | function | normalizeGoal(value: unknown) |  |  |  |  |

| `GoalState` | interface | interface GoalState |  |  |  |  |

| `GoalStatus` | type | type GoalStatus |  |  |  |  |


### packages/zcode-tui/src/index.ts

| `loginFailureDiagnostic` | function | loginFailureDiagnostic(stdout: string, stderr: string) |  |  |  |  |

| `runTui` | function | runTui(options: TuiOptions) |  |  |  |  |

| `shouldSuspendForLoginCommand` | function | shouldSuspendForLoginCommand(command: string) |  |  |  |  |

| `suppressTuiAiSdkWarnings` | function | suppressTuiAiSdkWarnings() |  |  |  |  |

| `addAssistantMessage` | method | addAssistantMessage(text: string, partId?: string, messageId?: string) |  |  |  |  |

| `addSystemEvent` | method | addSystemEvent(event: SystemEventData, blockId?: string) |  |  |  |  |

| `addUpdateAvailable` | method | addUpdateAvailable(currentVersion: string, latestVersion: string) |  |  |  |  |

| `addUserMessage` | method | addUserMessage(text: string, attachmentCount = 0, messageId?: string) |  |  |  |  |

| `appendThinking` | method | appendThinking(delta: string, partId?: string, messageId?: string) |  |  |  |  |

| `applyBackgroundTaskEvent` | method | applyBackgroundTaskEvent(event: StreamEvent) |  |  |  |  |

| `applyConversationRewind` | method | applyConversationRewind(target: RewindTarget, scope: RewindScope) |  |  |  |  |

| `applyExecutionState` | method | applyExecutionState(value: unknown) |  |  |  |  |

| `applyModeShortcut` | method | applyModeShortcut(requestedMode: Mode, announce = false) |  |  |  |  |

| `applyRuntimeProjection` | method | applyRuntimeProjection(projection: RuntimeProjectionSnapshot | undefined) |  |  |  |  |

| `applySessionUsage` | method | applySessionUsage(usage: unknown) |  |  |  |  |

| `applySettingCommand` | method | applySettingCommand(command: string, target: SettingTarget) |  |  |  |  |

| `attachClipboardImage` | method | attachClipboardImage() |  |  |  |  |

| `attachPendingToolRelationships` | method | attachPendingToolRelationships(tool: ToolViewState) |  |  |  |  |

| `attachToolAtRoot` | method | attachToolAtRoot(tool: ToolViewState) |  |  |  |  |

| `autocompleteCommands` | method | autocompleteCommands() |  |  |  |  |

| `backgroundTaskDetail` | method | backgroundTaskDetail(job: RuntimeBackgroundJob) |  |  |  |  |

| `beginTurn` | method | beginTurn(prompt?: string) |  |  |  |  |

| `bindInput` | method | bindInput() |  |  |  |  |

| `buildLayout` | method | buildLayout() |  |  |  |  |

| `canEnterAttachmentSelection` | method | canEnterAttachmentSelection() |  |  |  |  |

| `cancelActiveBackgroundAgentTasks` | method | cancelActiveBackgroundAgentTasks() |  |  |  |  |

| `clearPendingAttachments` | method | clearPendingAttachments(notify: boolean) |  |  |  |  |

| `clearRewindEscape` | method | clearRewindEscape() |  |  |  |  |

| `clearTranscriptProjection` | method | clearTranscriptProjection() |  |  |  |  |

| `completeThinking` | method | completeThinking(partId?: string) |  |  |  |  |

| `consumeRecentSteerCommitGuard` | method | consumeRecentSteerCommitGuard() |  |  |  |  |

| `copySelectionOrLastResponse` | method | copySelectionOrLastResponse() |  |  |  |  |

| `createEditor` | method | createEditor(tui: TUI) |  |  |  |  |

| `createTui` | method | createTui(mode: TuiMode) |  |  |  |  |

| `debugEvent` | method | debugEvent(channel: string, value: unknown) |  |  |  |  |

| `detachToolFromLocation` | method | detachToolFromLocation(tool: ToolViewState) |  |  |  |  |

| `drainInputAfterBackgroundHandoff` | method | drainInputAfterBackgroundHandoff() |  |  |  |  |

| `editLatestQueuedFollowUp` | method | editLatestQueuedFollowUp() |  |  |  |  |

| `enterAttachmentSelection` | method | enterAttachmentSelection() |  |  |  |  |

| `enterSessionRail` | method | enterSessionRail(immediate = false) |  |  |  |  |

| `finalizeUnresolvedTools` | method | finalizeUnresolvedTools(state: string, error?: unknown) |  |  |  |  |

| `finishStop` | method | finishStop(elapsedMilliseconds: number) |  |  |  |  |

| `finishTurn` | method | finishTurn(unfinishedToolState = "interrupted") |  |  |  |  |

| `focusEditor` | method | focusEditor() |  |  |  |  |

| `forceFullRedraw` | method | forceFullRedraw() |  |  |  |  |

| `fullscreenAltScreen` | method | fullscreenAltScreen() |  |  |  |  |

| `handleProtocolPartEvent` | method | handleProtocolPartEvent(event: StreamEvent) |  |  |  |  |

| `handleRewindEscape` | method | handleRewindEscape() |  |  |  |  |

| `handleSendOutcome` | method | handleSendOutcome(outcome: unknown) |  |  |  |  |

| `handleSessionRename` | method | handleSessionRename(title: string) |  |  |  |  |

| `handleSignal` | method | handleSignal(signal: NodeJS.Signals) |  |  |  |  |

| `handleSubagentLifecycle` | method | handleSubagentLifecycle(event: StreamEvent) |  |  |  |  |

| `handleTranscriptNavigation` | method | handleTranscriptNavigation(argument: string) |  |  |  |  |

| `handleTranscriptSearch` | method | handleTranscriptSearch(argument: string) |  |  |  |  |

| `installStreamErrorGuards` | method | installStreamErrorGuards() |  |  |  |  |

| `interruptBackgroundHandoffForInput` | method | interruptBackgroundHandoffForInput() |  |  |  |  |

| `isBackgroundCoordinatorReasoning` | method | isBackgroundCoordinatorReasoning(event: StreamEvent) |  |  |  |  |

| `isForeignSessionEvent` | method | isForeignSessionEvent(event: StreamEvent) |  |  |  |  |

| `isOverlayFocused` | method | isOverlayFocused() |  |  |  |  |

| `leaveAttachmentSelection` | method | leaveAttachmentSelection() |  |  |  |  |

| `loadHistory` | method | loadHistory() |  |  |  |  |

| `manageWorkflow` | method | manageWorkflow(runId: string) |  |  |  |  |

| `markPendingTurnNotificationFailed` | method | markPendingTurnNotificationFailed(detail?: string) |  |  |  |  |

| `mountLayout` | method | mountLayout() |  |  |  |  |

| `mountRegularSessionWelcome` | method | mountRegularSessionWelcome() |  |  |  |  |

| `noticeRestoredBackgroundTasks` | method | noticeRestoredBackgroundTasks(projection: RuntimeProjectionSnapshot) |  |  |  |  |

| `onEvent` | method | onEvent(value: unknown, turnEpoch?: number) |  |  |  |  |

| `onSessionEvent` | method | onSessionEvent(value: unknown) |  |  |  |  |

| `permissionPreview` | method | permissionPreview(toolName: string, input: unknown, riskLevel?: string) |  |  |  |  |

| `prepareTranscriptViewport` | method | prepareTranscriptViewport() |  |  |  |  |

| `promoteToolChildren` | method | promoteToolChildren(tool: ToolViewState) |  |  |  |  |

| `questionChoiceHelp` | method | questionChoiceHelp(canGoBack: boolean) |  |  |  |  |

| `queueCurrentEditorInput` | method | queueCurrentEditorInput() |  |  |  |  |

| `readContextDetailData` | method | readContextDetailData() |  |  |  |  |

| `readMcpSummary` | method | readMcpSummary() |  |  |  |  |

| `reconcileTurnTiming` | method | reconcileTurnTiming(projection: RuntimeProjectionSnapshot) |  |  |  |  |

| `recordAssistantText` | method | recordAssistantText(text: string) |  |  |  |  |

| `recoverSessionModel` | method | recoverSessionModel() |  |  |  |  |

| `refreshExecutionState` | method | refreshExecutionState() |  |  |  |  |

| `refreshExitUsage` | method | refreshExitUsage() |  |  |  |  |

| `refreshGoal` | method | refreshGoal() |  |  |  |  |

| `refreshModelOptions` | method | refreshModelOptions() |  |  |  |  |

| `refreshRuntimeState` | method | refreshRuntimeState() |  |  |  |  |

| `refreshSessionTerminalTitle` | method | refreshSessionTerminalTitle() |  |  |  |  |

| `refreshSessionUsage` | method | refreshSessionUsage() |  |  |  |  |

| `refreshWorkflowFromEvent` | method | refreshWorkflowFromEvent() |  |  |  |  |

| `rememberEditorHistory` | method | rememberEditorHistory(input: string) |  |  |  |  |

| `removePendingAttachment` | method | removePendingAttachment(index: number) |  |  |  |  |

| `removeProtocolMessage` | method | removeProtocolMessage(messageId: string) |  |  |  |  |

| `removeProtocolPart` | method | removeProtocolPart(partId: string) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderWorkflowPanel` | method | renderWorkflowPanel(value: Record<string, unknown>) |  |  |  |  |

| `requestForegroundTurnInterrupt` | method | requestForegroundTurnInterrupt() |  |  |  |  |

| `requestPendingSteerInterrupt` | method | requestPendingSteerInterrupt() |  |  |  |  |

| `requestPermission` | method | requestPermission(requestValue: unknown, context?: unknown) |  |  |  |  |

| `requestPermissionUnqueued` | method | requestPermissionUnqueued(requestValue: unknown, signal?: AbortSignal) |  |  |  |  |

| `requestPlanApproval` | method | requestPlanApproval(input: unknown, signal?: AbortSignal) |  |  |  |  |

| `requestStreamRender` | method | requestStreamRender() |  |  |  |  |

| `requestUserQuestions` | method | requestUserQuestions(input: unknown, signal?: AbortSignal) |  |  |  |  |

| `rescheduleRuntimePoll` | method | rescheduleRuntimePoll() |  |  |  |  |

| `resetSessionPresentation` | method | resetSessionPresentation() |  |  |  |  |

| `resolveTerminalColorScheme` | method | resolveTerminalColorScheme() |  |  |  |  |

| `restoreCustomSessionTitle` | method | restoreCustomSessionTitle() |  |  |  |  |

| `restoreInitialTranscript` | method | restoreInitialTranscript() |  |  |  |  |

| `restorePart` | method | restorePart(part: RestoredPart, role: "assistant" | "system", fallbackMessageId?: string) |  |  |  |  |

| `restoreSessionModel` | method | restoreSessionModel() |  |  |  |  |

| `restoreTranscript` | method | restoreTranscript(messages: RestoredMessage[]) |  |  |  |  |

| `rewindFilePreviewText` | method | rewindFilePreviewText(preview: FileRewindPreview | undefined, error?: string) |  |  |  |  |

| `run` | method | run() |  |  |  |  |

| `runFirstRunSetup` | method | runFirstRunSetup(manual = false) |  |  |  |  |

| `runSuspendedLogin` | method | runSuspendedLogin(displayInput: string, overrideCommand?: string) |  |  |  |  |

| `scheduleRuntimeRefresh` | method | scheduleRuntimeRefresh(delay = 80) |  |  |  |  |

| `sendTaskCommand` | method | sendTaskCommand(command: string, resume: boolean) |  |  |  |  |

| `setCopyOnSelect` | method | setCopyOnSelect(enabled: boolean) |  |  |  |  |

| `setCurrentInput` | method | setCurrentInput(data: string | undefined) |  |  |  |  |

| `setLoginRequired` | method | setLoginRequired(required: boolean) |  |  |  |  |

| `setToolParent` | method | setToolParent(tool: ToolViewState, parentToolCallId: string) |  |  |  |  |

| `settleThinking` | method | settleThinking(partId?: string) |  |  |  |  |

| `settleTurnTiming` | method | settleTurnTiming() |  |  |  |  |

| `shortcutAvailable` | method | shortcutAvailable() |  |  |  |  |

| `showActivityDetails` | method | showActivityDetails() |  |  |  |  |

| `showBackgroundTaskDetail` | method | showBackgroundTaskDetail(taskId: string) |  |  |  |  |

| `showBackgroundTasks` | method | showBackgroundTasks() |  |  |  |  |

| `showChoice` | method | showChoice(options: Parameters<typeof choose>[3]) |  |  |  |  |

| `showConfiguration` | method | showConfiguration() |  |  |  |  |

| `showContextDetails` | method | showContextDetails() |  |  |  |  |

| `showConversationRewind` | method | showConversationRewind() |  |  |  |  |

| `showDiffBrowser` | method | showDiffBrowser() |  |  |  |  |

| `showMcpPicker` | method | showMcpPicker() |  |  |  |  |

| `showModePicker` | method | showModePicker() |  |  |  |  |

| `showModelPicker` | method | showModelPicker() |  |  |  |  |

| `showModelProviderSettings` | method | showModelProviderSettings() |  |  |  |  |

| `showSelection` | method | showSelection(selection: Record<string, unknown>) |  |  |  |  |

| `showStatusDetails` | method | showStatusDetails() |  |  |  |  |

| `showTextPrompt` | method | showTextPrompt(options: Parameters<typeof promptText>[3]) |  |  |  |  |

| `showWorkflowPanel` | method | showWorkflowPanel(value: Record<string, unknown>) |  |  |  |  |

| `startUpdateRefresh` | method | startUpdateRefresh(updateCheck: StartupUpdateCheck | undefined) |  |  |  |  |

| `stop` | method | stop() |  |  |  |  |

| `stopBackgroundTask` | method | stopBackgroundTask(taskId: string) |  |  |  |  |

| `stopSessionTitleSpinner` | method | stopSessionTitleSpinner() |  |  |  |  |

| `submit` | method | submit(rawInput: string, queuedSubmission?: QueuedSubmission) |  |  |  |  |

| `suppressBackgroundCoordinatorMessage` | method | suppressBackgroundCoordinatorMessage(messageId: string | undefined) |  |  |  |  |

| `suppressBackgroundToolTranscript` | method | suppressBackgroundToolTranscript(event: StreamEvent) |  |  |  |  |

| `switchEffort` | method | switchEffort() |  |  |  |  |

| `switchMode` | method | switchMode() |  |  |  |  |

| `switchModel` | method | switchModel() |  |  |  |  |

| `switchPlan` | method | switchPlan(enabled?: boolean) |  |  |  |  |

| `switchTransientModel` | method | switchTransientModel(modelId: string) |  |  |  |  |

| `switchTuiMode` | method | switchTuiMode(next: TuiMode) |  |  |  |  |

| `syncAttachmentBar` | method | syncAttachmentBar() |  |  |  |  |

| `toolRelationshipWouldCycle` | method | toolRelationshipWouldCycle(childId: string, parent: ToolViewState) |  |  |  |  |

| `updateActivity` | method | updateActivity(activity: string | undefined, requestRender = true) |  |  |  |  |

| `updateLoginWarning` | method | updateLoginWarning() |  |  |  |  |

| `updateMetadata` | method | updateMetadata() |  |  |  |  |

| `updateRuntimeActivity` | method | updateRuntimeActivity(requestRender = true) |  |  |  |  |

| `updateTurnStatus` | method | updateTurnStatus(requestRender = true) |  |  |  |  |

| `upsertProtocolPart` | method | upsertProtocolPart(part: RestoredPart) |  |  |  |  |


### packages/zcode-tui/src/input-queue.ts

| `InputQueue` | class | class InputQueue |  |  |  |  |

| `CommittedSteer` | interface | interface CommittedSteer |  |  |  |  |

| `InputQueueCallbacks` | interface | interface InputQueueCallbacks |  |  |  |  |

| `InputQueueState` | interface | interface InputQueueState |  |  |  |  |

| `PendingSteerSubmission` | interface | interface PendingSteerSubmission |  |  |  |  |

| `QueuedSubmission` | interface | interface QueuedSubmission |  |  |  |  |

| `admittedPendingInputIds` | method | admittedPendingInputIds() |  |  |  |  |

| `associateSteer` | method | associateSteer(inputId: string, pendingInputId: string, targetTurnId?: string) |  |  |  |  |

| `autoSend` | method | autoSend() |  |  |  |  |

| `editLatestFollowUp` | method | editLatestFollowUp() |  |  |  |  |

| `findSteer` | method | findSteer(inputId: string | undefined) |  |  |  |  |

| `handleLifecycleEvent` | method | handleLifecycleEvent(event: StreamEvent) |  |  |  |  |

| `hasFollowUps` | method | hasFollowUps() |  |  |  |  |

| `hasPendingSteers` | method | hasPendingSteers() |  |  |  |  |

| `matchesTurn` | method | matchesTurn(left?: string, right?: string) |  |  |  |  |

| `queueFollowUp` | method | queueFollowUp(submission: QueuedSubmission) |  |  |  |  |

| `rememberCompletedTurn` | method | rememberCompletedTurn(turnId: string) |  |  |  |  |

| `rememberResolution` | method | rememberResolution(pendingInputId: string, resolution: PendingSteerResolution) |  |  |  |  |

| `removeSteer` | method | removeSteer(inputId: string | undefined) |  |  |  |  |

| `resetAutoSend` | method | resetAutoSend() |  |  |  |  |

| `restoreFollowUp` | method | restoreFollowUp(submission: QueuedSubmission) |  |  |  |  |

| `settleSteer` | method | settleSteer(pending: PendingSteerSubmission, resolution: PendingSteerResolution) |  |  |  |  |

| `syncView` | method | syncView() |  |  |  |  |

| `takeNextFollowUp` | method | takeNextFollowUp() |  |  |  |  |


### packages/zcode-tui/src/interactions.ts

| `answeredQuestionInput` | function | answeredQuestionInput(input: unknown, answers: Record<string, string>) |  |  |  |  |

| `defaultPermissionChoices` | function | defaultPermissionChoices(toolName: string, input: unknown) |  |  |  |  |

| `isAskUserQuestionTool` | function | isAskUserQuestionTool(name: string) |  |  |  |  |

| `isExitPlanModeTool` | function | isExitPlanModeTool(name: string) |  |  |  |  |

| `parseUserQuestions` | function | parseUserQuestions(input: unknown) |  |  |  |  |

| `planText` | function | planText(input: unknown) |  |  |  |  |

| `PermissionChoice` | interface | interface PermissionChoice |  |  |  |  |

| `UserQuestion` | interface | interface UserQuestion |  |  |  |  |

| `UserQuestionOption` | interface | interface UserQuestionOption |  |  |  |  |

| `UserQuestionAnswerResult` | type | type UserQuestionAnswerResult |  |  |  |  |

| `UserQuestionAnswerer` | type | type UserQuestionAnswerer |  |  |  |  |


### packages/zcode-tui/src/notifications.ts

| `TurnNotifier` | class | class TurnNotifier |  |  |  |  |

| `detectedTerminal` | function | detectedTerminal(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `notificationPreview` | function | notificationPreview(value: string, maximum = notificationPreviewGraphemes) |  |  |  |  |

| `osc9NotificationSequence` | function | osc9NotificationSequence(message: string, tmux = false) |  |  |  |  |

| `supportsOsc9` | function | supportsOsc9(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `NativeNotificationCommand` | interface | interface NativeNotificationCommand |  |  |  |  |

| `NotificationDiagnostics` | interface | interface NotificationDiagnostics |  |  |  |  |

| `NotificationSettings` | interface | interface NotificationSettings |  |  |  |  |

| `currentSettings` | method | currentSettings() |  |  |  |  |

| `diagnostics` | method | diagnostics() |  |  |  |  |

| `disableFocusReporting` | method | disableFocusReporting() |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `markTerminalUnavailable` | method | markTerminalUnavailable() |  |  |  |  |

| `notify` | method | notify(kind: TurnNotificationKind, detail = "") |  |  |  |  |

| `setFocusReportingRequired` | method | setFocusReportingRequired(required: boolean) |  |  |  |  |

| `setSettings` | method | setSettings(settings: NotificationSettings) |  |  |  |  |

| `start` | method | start() |  |  |  |  |

| `stop` | method | stop() |  |  |  |  |

| `syncFocusReporting` | method | syncFocusReporting() |  |  |  |  |

| `writeNative` | method | writeNative(title: string, body: string) |  |  |  |  |

| `writeOsc9` | method | writeOsc9(body: string) |  |  |  |  |

| `writeTerminal` | method | writeTerminal(data: string) |  |  |  |  |

| `NativeNotificationSender` | type | type NativeNotificationSender |  |  |  |  |

| `NotificationBackend` | type | type NotificationBackend |  |  |  |  |

| `NotificationCondition` | type | type NotificationCondition |  |  |  |  |

| `NotificationMethod` | type | type NotificationMethod |  |  |  |  |

| `TerminalFocusState` | type | type TerminalFocusState |  |  |  |  |

| `TurnNotificationKind` | type | type TurnNotificationKind |  |  |  |  |


### packages/zcode-tui/src/panels.ts

| `formatWorkflowPanel` | function | formatWorkflowPanel(value: unknown) |  |  |  |  |

| `isMcpPickerRequest` | function | isMcpPickerRequest(input: string) |  |  |  |  |

| `isTerminalWorkflowStatus` | function | isTerminalWorkflowStatus(status?: string) |  |  |  |  |

| `mcpPicker` | function | mcpPicker(value: unknown) |  |  |  |  |

| `workflowRunPicker` | function | workflowRunPicker(value: unknown) |  |  |  |  |

| `workflowSelectedRunId` | function | workflowSelectedRunId(value: unknown) |  |  |  |  |

| `workflowStatus` | function | workflowStatus(value: unknown, runId: string) |  |  |  |  |


### packages/zcode-tui/src/permission-request-queue.ts

| `PermissionRequestQueue` | class | class PermissionRequestQueue |  |  |  |  |


### packages/zcode-tui/src/permission-view.ts

| `PermissionPreview` | class | class PermissionPreview |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |


### packages/zcode-tui/src/plan-editor.ts

| `PlanEditor` | class | class PlanEditor |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |


### packages/zcode-tui/src/plan-view.ts

| `PlanUpdateView` | class | class PlanUpdateView |  |  |  |  |

| `isPlanUpdateTool` | function | isPlanUpdateTool(name: string) |  |  |  |  |

| `planCard` | function | planCard(options: PlanUpdateOptions) |  |  |  |  |

| `planHasHiddenItems` | function | planHasHiddenItems(input: unknown, result: unknown) |  |  |  |  |

| `PlanUpdateOptions` | interface | interface PlanUpdateOptions |  |  |  |  |


### packages/zcode-tui/src/plugin-references.ts

| `PluginReferenceCatalog` | class | class PluginReferenceCatalog |  |  |  |  |

| `isPluginReferenceValue` | function | isPluginReferenceValue(value: string) |  |  |  |  |

| `normalizePluginReferenceEntries` | function | normalizePluginReferenceEntries(result: unknown) |  |  |  |  |

| `pluginReferenceMarkdown` | function | pluginReferenceMarkdown(plugin: PluginReferenceEntry) |  |  |  |  |

| `PluginReferenceEntry` | interface | interface PluginReferenceEntry |  |  |  |  |

| `list` | method | list() |  |  |  |  |


### packages/zcode-tui/src/protocol-part-view.ts

| `ProtocolPartView` | class | class ProtocolPartView |  |  |  |  |

| `isVisibleProtocolPart` | function | isVisibleProtocolPart(part: RestoredPart) |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `lines` | method | lines() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `update` | method | update(part: RestoredPart) |  |  |  |  |


### packages/zcode-tui/src/queued-input-view.ts

| `QueuedInputView` | class | class QueuedInputView |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setState` | method | setState(state: QueuedInputViewState) |  |  |  |  |

| `QueuedInputViewState` | type | type QueuedInputViewState |  |  |  |  |


### packages/zcode-tui/src/renderable.ts

| `isExpandableComponent` | function | isExpandableComponent(component: Component) |  |  |  |  |

| `isSearchableComponent` | function | isSearchableComponent(component: Component) |  |  |  |  |

| `isWindowedComponent` | function | isWindowedComponent(component: Component) |  |  |  |  |

| `ExpandableComponent` | interface | interface ExpandableComponent |  |  |  |  |

| `SearchableComponent` | interface | interface SearchableComponent |  |  |  |  |

| `WindowedComponent` | interface | interface WindowedComponent |  |  |  |  |

| `WindowedRenderResult` | interface | interface WindowedRenderResult |  |  |  |  |


### packages/zcode-tui/src/rewind.ts

| `fileRewindPreview` | function | fileRewindPreview(value: unknown) |  |  |  |  |

| `rewindCommand` | function | rewindCommand(scope: "conversation", messageId: string) |  |  |  |  |

| `rewindTargetLabel` | function | rewindTargetLabel(text: string, maximum = 100) |  |  |  |  |

| `rewindTargets` | function | rewindTargets(value: unknown) |  |  |  |  |

| `FileRewindEntry` | interface | interface FileRewindEntry |  |  |  |  |

| `FileRewindPreview` | interface | interface FileRewindPreview |  |  |  |  |

| `RewindTarget` | interface | interface RewindTarget |  |  |  |  |

| `RewindScope` | type | type RewindScope |  |  |  |  |


### packages/zcode-tui/src/rich-markdown.ts

| `RichMarkdown` | class | class RichMarkdown |  |  |  |  |

| `isPlainMarkdownBlock` | function | isPlainMarkdownBlock(text: string) |  |  |  |  |

| `normalizeMermaidTerminalWidth` | function | normalizeMermaidTerminalWidth(source: string) |  |  |  |  |

| `renderMermaidPreview` | function | renderMermaidPreview(source: string, width: number) |  |  |  |  |

| `splitMarkdownSegments` | function | splitMarkdownSegments(text: string) |  |  |  |  |

| `splitStreamingMarkdownSegments` | function | splitStreamingMarkdownSegments(text: string) |  |  |  |  |

| `appendText` | method | appendText(delta: string) |  |  |  |  |

| `appendWrappedLines` | method | appendWrappedLines(contentWidth: number) |  |  |  |  |

| `finishText` | method | finishText() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `highlightedCodeLines` | method | highlightedCodeLines() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `invalidateTextLayout` | method | invalidateTextLayout() |  |  |  |  |

| `measureWindowLayout` | method | measureWindowLayout(width: number) |  |  |  |  |

| `presentLines` | method | presentLines(lines: string[], width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderFlatOptimized` | method | renderFlatOptimized(width: number) |  |  |  |  |

| `renderNestedOptimized` | method | renderNestedOptimized(width: number) |  |  |  |  |

| `renderOptimized` | method | renderOptimized(width: number) |  |  |  |  |

| `renderWindow` | method | renderWindow(width: number, start: number, count: number) |  |  |  |  |

| `resetWrapping` | method | resetWrapping() |  |  |  |  |

| `separatorRow` | method | separatorRow(width: number) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |

| `syncRenderedSegments` | method | syncRenderedSegments() |  |  |  |  |

| `tryAppend` | method | tryAppend(text: string) |  |  |  |  |

| `windowComponents` | method | windowComponents(rendered: RenderedMarkdownSegment) |  |  |  |  |

| `MarkdownSegment` | type | type MarkdownSegment |  |  |  |  |


### packages/zcode-tui/src/runtime-activity-view.ts

| `RuntimeActivityView` | class | class RuntimeActivityView |  |  |  |  |

| `RuntimeActivityState` | interface | interface RuntimeActivityState |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `update` | method | update(state: RuntimeActivityState) |  |  |  |  |


### packages/zcode-tui/src/runtime-poll.ts

| `ACTIVE_RUNTIME_POLL_INTERVAL_MS` | const | ACTIVE_RUNTIME_POLL_INTERVAL_MS |  |  |  |  |

| `IDLE_RUNTIME_POLL_INTERVAL_MS` | const | IDLE_RUNTIME_POLL_INTERVAL_MS |  |  |  |  |

| `runtimeActivityActive` | function | runtimeActivityActive(projection: RuntimeProjectionSnapshot | undefined) |  |  |  |  |

| `runtimePollInterval` | function | runtimePollInterval(active: boolean) |  |  |  |  |

| `runtimePollStateChanged` | function | runtimePollStateChanged(current: RuntimePollState, next: RuntimePollState) |  |  |  |  |

| `RuntimePollState` | interface | interface RuntimePollState |  |  |  |  |


### packages/zcode-tui/src/runtime-projection.ts

| `isActiveBackgroundJob` | function | isActiveBackgroundJob(job: RuntimeBackgroundJob) |  |  |  |  |

| `isActiveRuntimeTool` | function | isActiveRuntimeTool(tool: RuntimeActiveToolCall) |  |  |  |  |

| `normalizeRuntimeProjection` | function | normalizeRuntimeProjection(value: unknown) |  |  |  |  |

| `normalizeTodoGroups` | function | normalizeTodoGroups(value: unknown) |  |  |  |  |

| `normalizeTodos` | function | normalizeTodos(value: unknown) |  |  |  |  |

| `RuntimeActiveToolCall` | interface | interface RuntimeActiveToolCall |  |  |  |  |

| `RuntimeBackgroundJob` | interface | interface RuntimeBackgroundJob |  |  |  |  |

| `RuntimeContextBreakdownItem` | interface | interface RuntimeContextBreakdownItem |  |  |  |  |

| `RuntimeContextUsage` | interface | interface RuntimeContextUsage |  |  |  |  |

| `RuntimeProjectionSnapshot` | interface | interface RuntimeProjectionSnapshot |  |  |  |  |

| `RuntimeTodo` | interface | interface RuntimeTodo |  |  |  |  |

| `RuntimeTodoGroup` | interface | interface RuntimeTodoGroup |  |  |  |  |

| `RuntimeBackgroundStatus` | type | type RuntimeBackgroundStatus |  |  |  |  |

| `RuntimeTaskKind` | type | type RuntimeTaskKind |  |  |  |  |

| `RuntimeToolStatus` | type | type RuntimeToolStatus |  |  |  |  |


### packages/zcode-tui/src/selection-command.ts

| `parseSelectionCommand` | function | parseSelectionCommand(value: unknown, index: number) |  |  |  |  |

| `protectSubmission` | function | protectSubmission(input: string) |  |  |  |  |

| `redactSecrets` | function | redactSecrets(message: string, secrets: string[]) |  |  |  |  |

| `ProtectedSubmission` | interface | interface ProtectedSubmission |  |  |  |  |

| `SelectionCommand` | interface | interface SelectionCommand |  |  |  |  |

| `SelectionInteraction` | interface | interface SelectionInteraction |  |  |  |  |


### packages/zcode-tui/src/selectors.ts

| `effortPicker` | function | effortPicker(options: unknown[], currentEffort?: string) |  |  |  |  |

| `explicitModelRequest` | function | explicitModelRequest(input: string) |  |  |  |  |

| `isEffortPickerRequest` | function | isEffortPickerRequest(input: string) |  |  |  |  |

| `isModePickerRequest` | function | isModePickerRequest(input: string) |  |  |  |  |

| `isModelPickerRequest` | function | isModelPickerRequest(input: string) |  |  |  |  |

| `modePicker` | function | modePicker(currentMode?: string, availableModes?: readonly string[]) |  |  |  |  |

| `modelPicker` | function | modelPicker(options: unknown[], currentModel?: string) |  |  |  |  |

| `sessionRenameRequest` | function | sessionRenameRequest(input: string) |  |  |  |  |

| `PickerItem` | interface | interface PickerItem |  |  |  |  |

| `PickerSpec` | interface | interface PickerSpec |  |  |  |  |


### packages/zcode-tui/src/session-status.ts

| `contextRemainingPercent` | function | contextRemainingPercent(metrics: SessionMetrics) |  |  |  |  |

| `contextUsedPercent` | function | contextUsedPercent(metrics: SessionMetrics) |  |  |  |  |

| `mergeMetrics` | function | mergeMetrics(current: SessionMetrics, update: SessionMetrics | undefined) |  |  |  |  |

| `projectionMetrics` | function | projectionMetrics(value: unknown) |  |  |  |  |

| `sessionIdFromUsage` | function | sessionIdFromUsage(value: unknown) |  |  |  |  |

| `usageMetrics` | function | usageMetrics(value: unknown) |  |  |  |  |

| `SessionMetrics` | interface | interface SessionMetrics |  |  |  |  |


### packages/zcode-tui/src/session-title.ts

| `MAX_SESSION_TITLE_CHARS` | const | MAX_SESSION_TITLE_CHARS |  |  |  |  |

| `SESSION_TITLE_PREFIX` | const | SESSION_TITLE_PREFIX |  |  |  |  |

| `SESSION_TITLE_SPINNER_FRAME_DURATION_MS` | const | SESSION_TITLE_SPINNER_FRAME_DURATION_MS |  |  |  |  |

| `normalizeSessionTitle` | function | normalizeSessionTitle(title: string) |  |  |  |  |

| `sessionTitleFromFirstMessage` | function | sessionTitleFromFirstMessage(message: string) |  |  |  |  |

| `sessionTitleSpinnerFrame` | function | sessionTitleSpinnerFrame(elapsedMilliseconds: number, animated = true) |  |  |  |  |


### packages/zcode-tui/src/shortcuts.ts

| `modes` | const | modes |  |  |  |  |

| `appliesToSetting` | function | appliesToSetting(target: SettingTarget | undefined, field: SettingTarget) |  |  |  |  |

| `nextMode` | function | nextMode(currentMode?: string) |  |  |  |  |

| `nextPickerCommand` | function | nextPickerCommand(picker: PickerSpec, currentValue?: string) |  |  |  |  |

| `nextPickerValue` | function | nextPickerValue(picker: PickerSpec, currentValue?: string) |  |  |  |  |

| `normalizedMode` | function | normalizedMode(mode?: string, fallback: Mode = "build") |  |  |  |  |

| `settingTargetForCommand` | function | settingTargetForCommand(input: string) |  |  |  |  |

| `transcriptPageDirection` | function | transcriptPageDirection(data: string) |  |  |  |  |

| `Mode` | type | type Mode |  |  |  |  |

| `SettingTarget` | type | type SettingTarget |  |  |  |  |


### packages/zcode-tui/src/skills.ts

| `SkillCatalog` | class | class SkillCatalog |  |  |  |  |

| `normalizeSkillEntries` | function | normalizeSkillEntries(result: unknown) |  |  |  |  |

| `resolveSkillMentions` | function | resolveSkillMentions(input: string, skills: SkillEntry[]) |  |  |  |  |

| `PreparedSkillPrompt` | interface | interface PreparedSkillPrompt |  |  |  |  |

| `SkillEntry` | interface | interface SkillEntry |  |  |  |  |

| `list` | method | list() |  |  |  |  |

| `preparePrompt` | method | preparePrompt(input: string) |  |  |  |  |


### packages/zcode-tui/src/status-line.ts

| `StatusLine` | class | class StatusLine |  |  |  |  |

| `StatusLineField` | interface | interface StatusLineField |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setFields` | method | setFields(fields: StatusLineField[], separator = " · ") |  |  |  |  |

| `width` | method | width(fields: RenderedField[]) |  |  |  |  |


### packages/zcode-tui/src/stream-error-guard.ts

| `StreamErrorSource` | interface | interface StreamErrorSource |  |  |  |  |


### packages/zcode-tui/src/system-event-view.ts

| `SystemEventView` | class | class SystemEventView |  |  |  |  |

| `SystemEventData` | interface | interface SystemEventData |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |


### packages/zcode-tui/src/terminal-text.ts

| `StreamingTerminalTextSanitizer` | class | class StreamingTerminalTextSanitizer |  |  |  |  |

| `removeLastGrapheme` | function | removeLastGrapheme(value: string) |  |  |  |  |

| `wrapTerminalText` | function | wrapTerminalText(value: string, width: number) |  |  |  |  |

| `SanitizeTerminalTextOptions` | interface | interface SanitizeTerminalTextOptions |  |  |  |  |

| `append` | method | append(value: string) |  |  |  |  |

| `finish` | method | finish() |  |  |  |  |

| `reset` | method | reset() |  |  |  |  |


### packages/zcode-tui/src/theme.ts

| `createTheme` | function | createTheme(enabled: boolean, initialColorScheme: ZCodeColorScheme = "dark") |  |  |  |  |

| `ZCodeTheme` | interface | interface ZCodeTheme |  |  |  |  |


### packages/zcode-tui/src/thinking-view.ts

| `ThinkingView` | class | class ThinkingView |  |  |  |  |

| `append` | method | append(delta: string) |  |  |  |  |

| `complete` | method | complete() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `replace` | method | replace(text: string) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |

| `trim` | method | trim() |  |  |  |  |

| `value` | method | value() |  |  |  |  |


### packages/zcode-tui/src/tool-group-view.ts

| `ToolGroupView` | class | class ToolGroupView |  |  |  |  |

| `addTool` | method | addTool(tool: ToolExecutionView) |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `removeTool` | method | removeTool(tool: ToolExecutionView) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `size` | method | size() |  |  |  |  |


### packages/zcode-tui/src/tool-payload.ts

| `MAX_RETAINED_TOOL_IMAGE_CHARACTERS` | const | MAX_RETAINED_TOOL_IMAGE_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_CHARACTERS` | const | MAX_RETAINED_TOOL_PAYLOAD_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_DEPTH` | const | MAX_RETAINED_TOOL_PAYLOAD_DEPTH |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_ENTRIES` | const | MAX_RETAINED_TOOL_PAYLOAD_ENTRIES |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_NODES` | const | MAX_RETAINED_TOOL_PAYLOAD_NODES |  |  |  |  |

| `OMITTED_BINARY_PAYLOAD_PREFIX` | const | OMITTED_BINARY_PAYLOAD_PREFIX |  |  |  |  |

| `TOOL_PAYLOAD_LIMITS` | const | TOOL_PAYLOAD_LIMITS |  |  |  |  |

| `isOmittedBinaryPayload` | function | isOmittedBinaryPayload(value: string) |  |  |  |  |

| `toolPayloadSize` | function | toolPayloadSize(value: unknown) |  |  |  |  |

| `CompactedToolPayloads` | interface | interface CompactedToolPayloads |  |  |  |  |

| `ToolPayloadLimits` | interface | interface ToolPayloadLimits |  |  |  |  |

| `ToolPayloadSize` | interface | interface ToolPayloadSize |  |  |  |  |

| `compact` | method | compact(value: unknown, depth = 0, key?: string, binary = false) |  |  |  |  |

| `compactString` | method | compactString(value: string, key?: string, binary = false) |  |  |  |  |

| `exhausted` | method | exhausted() |  |  |  |  |

| `reserveKey` | method | reserveKey(key: string) |  |  |  |  |

| `size` | method | size() |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/execution.ts

| `agentRender` | function | agentRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `bashRender` | function | bashRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `taskOutputDisplay` | function | taskOutputDisplay(result: unknown) |  |  |  |  |

| `taskOutputRender` | function | taskOutputRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `taskStopRender` | function | taskStopRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/filesystem.ts

| `mutationRender` | function | mutationRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `readRender` | function | readRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `searchRender` | function | searchRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/helpers.ts

| `booleanField` | function | booleanField(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `compactStatusLine` | function | compactStatusLine(values: Array<string | undefined>, theme: ZCodeTheme) |  |  |  |  |

| `directText` | function | directText(value: unknown, depth = 0) |  |  |  |  |

| `formatBytes` | function | formatBytes(bytes?: number) |  |  |  |  |

| `formatElapsed` | function | formatElapsed(milliseconds?: number) |  |  |  |  |

| `nestedRecord` | function | nestedRecord(value: unknown, depth = 0) |  |  |  |  |

| `numberField` | function | numberField(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `oneLine` | function | oneLine(value: string, limit = 100) |  |  |  |  |

| `quoted` | function | quoted(value: string) |  |  |  |  |

| `recordString` | function | recordString(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `safeJson` | function | safeJson(value: unknown) |  |  |  |  |

| `toolSummary` | function | toolSummary(name: string, input: unknown) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/index.ts

| `specializedToolRender` | function | specializedToolRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/interaction.ts

| `questionRender` | function | questionRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `sendMessageRender` | function | sendMessageRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `skillRender` | function | skillRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/registry.ts

| `canonicalToolName` | function | canonicalToolName(name: string) |  |  |  |  |

| `displayNameForMcp` | function | displayNameForMcp(name: string) |  |  |  |  |

| `isAgentDispatchTool` | function | isAgentDispatchTool(name: string | undefined) |  |  |  |  |

| `isGroupedInformationTool` | function | isGroupedInformationTool(name: string) |  |  |  |  |

| `isKnownTool` | function | isKnownTool(name: string) |  |  |  |  |

| `normalizeToolName` | function | normalizeToolName(name: string) |  |  |  |  |

| `toolGroupKind` | function | toolGroupKind(name: string) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/types.ts

| `officialToolNames` | const | officialToolNames |  |  |  |  |

| `SpecializedToolRenderOptions` | interface | interface SpecializedToolRenderOptions |  |  |  |  |

| `SpecializedToolRenderResult` | interface | interface SpecializedToolRenderResult |  |  |  |  |

| `ToolProgressData` | interface | interface ToolProgressData |  |  |  |  |

| `CanonicalToolName` | type | type CanonicalToolName |  |  |  |  |

| `OfficialToolName` | type | type OfficialToolName |  |  |  |  |

| `ToolRenderer` | type | type ToolRenderer |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/web.ts

| `linkRows` | function | linkRows(record: Record<string, unknown> | undefined) |  |  |  |  |

| `mcpRender` | function | mcpRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `webFetchRender` | function | webFetchRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `webSearchRender` | function | webSearchRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-renderers/workflow.ts

| `goalReadRender` | function | goalReadRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `planModeRender` | function | planModeRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `sessionContextRender` | function | sessionContextRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `todoReadRender` | function | todoReadRender(options: SpecializedToolRenderOptions) |  |  |  |  |


### packages/zcode-tui/src/tool-tree-view.ts

| `ToolTreeView` | class | class ToolTreeView |  |  |  |  |

| `addChild` | method | addChild(child: ToolTreeView) |  |  |  |  |

| `descendantCount` | method | descendantCount() |  |  |  |  |

| `getChildren` | method | getChildren() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `removeChild` | method | removeChild(child: ToolTreeView) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |


### packages/zcode-tui/src/tool-view.ts

| `ToolExecutionView` | class | class ToolExecutionView |  |  |  |  |

| `compactTerminalToolOptions` | function | compactTerminalToolOptions(options: ToolViewOptions) |  |  |  |  |

| `isTerminalToolState` | function | isTerminalToolState(state: string) |  |  |  |  |

| `toolCard` | function | toolCard(options: ToolViewOptions) |  |  |  |  |

| `toolSucceeded` | function | toolSucceeded(value: unknown) |  |  |  |  |

| `ToolViewOptions` | interface | interface ToolViewOptions |  |  |  |  |

| `ensureRebuilt` | method | ensureRebuilt() |  |  |  |  |

| `getName` | method | getName() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `getState` | method | getState() |  |  |  |  |

| `getSummary` | method | getSummary() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `isTerminal` | method | isTerminal() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `update` | method | update(options: ToolViewOptions) |  |  |  |  |


### packages/zcode-tui/src/transcript.ts

| `Transcript` | class | class Transcript |  |  |  |  |

| `MAX_RETAINED_TRANSCRIPT_BLOCKS` | const | MAX_RETAINED_TRANSCRIPT_BLOCKS |  |  |  |  |

| `MAX_RETAINED_TRANSCRIPT_HISTORY_CHARACTERS` | const | MAX_RETAINED_TRANSCRIPT_HISTORY_CHARACTERS |  |  |  |  |

| `TRANSCRIPT_RENDER_WINDOW_BLOCKS` | const | TRANSCRIPT_RENDER_WINDOW_BLOCKS |  |  |  |  |

| `TranscriptBlockOptions` | interface | interface TranscriptBlockOptions |  |  |  |  |

| `TranscriptCursorStatus` | interface | interface TranscriptCursorStatus |  |  |  |  |

| `TranscriptSearchStatus` | interface | interface TranscriptSearchStatus |  |  |  |  |

| `addBlock` | method | addBlock(component: Component, options: TranscriptBlockOptions = {}) |  |  |  |  |

| `advanceWindow` | method | advanceWindow() |  |  |  |  |

| `associateBlockWithMessage` | method | associateBlockWithMessage(id: string, messageId: string) |  |  |  |  |

| `blockCount` | method | blockCount() |  |  |  |  |

| `blockSearchText` | method | blockSearchText(block: TranscriptBlock) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `clearCursor` | method | clearCursor() |  |  |  |  |

| `clearSearch` | method | clearSearch() |  |  |  |  |

| `cursorStatus` | method | cursorStatus() |  |  |  |  |

| `discardedBlockCount` | method | discardedBlockCount() |  |  |  |  |

| `discardedHistorySuffix` | method | discardedHistorySuffix() |  |  |  |  |

| `enforceRetentionBudget` | method | enforceRetentionBudget() |  |  |  |  |

| `focusedBlockIndex` | method | focusedBlockIndex() |  |  |  |  |

| `historyRetentionHeader` | method | historyRetentionHeader(searchableBlocks: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `matchingBlocks` | method | matchingBlocks(query: string) |  |  |  |  |

| `moveCursor` | method | moveCursor(direction: 1 | -1) |  |  |  |  |

| `movePage` | method | movePage(direction: 1 | -1, width: number) |  |  |  |  |

| `nextSearchMatch` | method | nextSearchMatch(direction: 1 | -1) |  |  |  |  |

| `presentStableBlock` | method | presentStableBlock(block: TranscriptBlock, sourceLines: string[], width: number) |  |  |  |  |

| `refreshSearch` | method | refreshSearch() |  |  |  |  |

| `releaseBlockCache` | method | releaseBlockCache(block: TranscriptBlock) |  |  |  |  |

| `removeBlock` | method | removeBlock(id: string) |  |  |  |  |

| `removeMessage` | method | removeMessage(messageId: string) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `retainedHistoryCharacters` | method | retainedHistoryCharacters() |  |  |  |  |

| `searchFor` | method | searchFor(query: string) |  |  |  |  |

| `searchStatus` | method | searchStatus() |  |  |  |  |

| `selectLatest` | method | selectLatest() |  |  |  |  |

| `selectedText` | method | selectedText() |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setNavigationViewportRows` | method | setNavigationViewportRows(rows: number) |  |  |  |  |

| `stickyPrompt` | method | stickyPrompt(before: number) |  |  |  |  |

| `toggleExpanded` | method | toggleExpanded() |  |  |  |  |

| `toggleFocusedExpanded` | method | toggleFocusedExpanded() |  |  |  |  |

| `visibleSelection` | method | visibleSelection() |  |  |  |  |


### packages/zcode-tui/src/tui-mode.ts

| `TuiMode` | type | type TuiMode |  |  |  |  |


### packages/zcode-tui/src/turn-diff-store.ts

| `TurnDiffStore` | class | class TurnDiffStore |  |  |  |  |

| `MAX_RETAINED_TURN_DIFFS` | const | MAX_RETAINED_TURN_DIFFS |  |  |  |  |

| `TurnDiffSnapshot` | interface | interface TurnDiffSnapshot |  |  |  |  |

| `beginTurn` | method | beginTurn(prompt?: string) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `enforceCurrentBudget` | method | enforceCurrentBudget() |  |  |  |  |

| `finishTurn` | method | finishTurn() |  |  |  |  |

| `snapshots` | method | snapshots() |  |  |  |  |

| `upsertTool` | method | upsertTool(toolCallId: string, diffs: FileDiffData[]) |  |  |  |  |


### packages/zcode-tui/src/turn-presentation-registry.ts

| `TurnPresentationRegistry` | class | class TurnPresentationRegistry |  |  |  |  |

| `TurnPresentationRegistrySizes` | interface | interface TurnPresentationRegistrySizes |  |  |  |  |

| `beginTurn` | method | beginTurn() |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `sizes` | method | sizes() |  |  |  |  |


### packages/zcode-tui/src/turn-status.ts

| `TURN_TIMER_FRAME_DURATION_MS` | const | TURN_TIMER_FRAME_DURATION_MS |  |  |  |  |

| `formatElapsed` | function | formatElapsed(milliseconds: number) |  |  |  |  |

| `turnTimerFrame` | function | turnTimerFrame(elapsedMilliseconds: number, animated = false) |  |  |  |  |


### packages/zcode-tui/src/turn-work-tracker.ts

| `TurnWorkTracker` | class | class TurnWorkTracker |  |  |  |  |

| `accepts` | method | accepts(turnId: string | undefined) |  |  |  |  |

| `begin` | method | begin() |  |  |  |  |

| `bindTurn` | method | bindTurn(turnId: string | undefined) |  |  |  |  |

| `cancel` | method | cancel() |  |  |  |  |

| `finishForeground` | method | finishForeground(awaitProjection: boolean) |  |  |  |  |

| `handle` | method | handle(event: StreamEvent) |  |  |  |  |

| `isActive` | method | isActive() |  |  |  |  |

| `ownsTask` | method | ownsTask(taskId: string | undefined) |  |  |  |  |

| `reconcile` | method | reconcile(projection: RuntimeProjectionSnapshot) |  |  |  |  |


### packages/zcode-tui/src/types.ts

| `asString` | function | asString(value: unknown) |  |  |  |  |

| `isRecord` | function | isRecord(value: unknown) |  |  |  |  |

| `InterruptTurnOptions` | interface | interface InterruptTurnOptions |  |  |  |  |

| `PromptCallOptions` | interface | interface PromptCallOptions |  |  |  |  |

| `RuntimeAdapter` | interface | interface RuntimeAdapter |  |  |  |  |

| `SkillSuggestion` | interface | interface SkillSuggestion |  |  |  |  |

| `SkillSuggestionResult` | interface | interface SkillSuggestionResult |  |  |  |  |

| `SlashCommandOption` | interface | interface SlashCommandOption |  |  |  |  |

| `TuiOptions` | interface | interface TuiOptions |  |  |  |  |

| `WorkspacePathSuggestion` | interface | interface WorkspacePathSuggestion |  |  |  |  |

| `WorkspacePathSuggestionRequest` | interface | interface WorkspacePathSuggestionRequest |  |  |  |  |

| `WorkspacePathSuggestionResult` | interface | interface WorkspacePathSuggestionResult |  |  |  |  |

| `ListPluginReferences` | type | type ListPluginReferences |  |  |  |  |

| `ListSkills` | type | type ListSkills |  |  |  |  |

| `ListWorkspacePathSuggestions` | type | type ListWorkspacePathSuggestions |  |  |  |  |

| `UnknownRecord` | type | type UnknownRecord |  |  |  |  |


### packages/zcode-tui/src/update-available-view.ts

| `UpdateAvailableView` | class | class UpdateAvailableView |  |  |  |  |

| `releaseNotesUrl` | const | releaseNotesUrl |  |  |  |  |

| `updateCommand` | const | updateCommand |  |  |  |  |


### packages/zcode-tui/src/welcome-banner.ts

| `Divider` | class | class Divider |  |  |  |  |

| `WelcomeBanner` | class | class WelcomeBanner |  |  |  |  |

| `BRAND_MARK` | const | BRAND_MARK |  |  |  |  |

| `BRAND_MARK_WIDTH` | const | BRAND_MARK_WIDTH |  |  |  |  |

| `WIDE_BANNER_MIN_WIDTH` | const | WIDE_BANNER_MIN_WIDTH |  |  |  |  |

| `WelcomeBannerOptions` | interface | interface WelcomeBannerOptions |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `locationLine` | method | locationLine(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderCompact` | method | renderCompact(width: number) |  |  |  |  |

| `renderWide` | method | renderWide(width: number) |  |  |  |  |


### packages/zcode-tui/src/work-duration-view.ts

| `WorkDurationView` | class | class WorkDurationView |  |  |  |  |

| `workedDurationLabel` | function | workedDurationLabel(elapsedMilliseconds: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |


### packages/zcode-tui/src/workspace-autocomplete.ts

| `WorkspaceAutocompleteProvider` | class | class WorkspaceAutocompleteProvider |  |  |  |  |

| `shouldTriggerFileCompletion` | method | shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number) |  |  |  |  |


### packages/zcode-tui/src/workspace-diff.ts

| `parseWorkspaceDiff` | function | parseWorkspaceDiff(patchText: string, statusText: string, truncated = false) |  |  |  |  |

| `readWorkspaceDiff` | function | readWorkspaceDiff(workspaceDirectory: string) |  |  |  |  |

| `WorkspaceDiffSnapshot` | interface | interface WorkspaceDiffSnapshot |  |  |  |  |


### scripts/bench-parts-alternatives.ts

| `benchSize` | function | benchSize(parts: number, runs: number) |  |  |  |  |

| `syntheticGraph` | function | syntheticGraph(parts: number, seed = 26_926) |  |  |  |  |

| `BenchRow` | interface | interface BenchRow |  |  |  |  |


### scripts/bench-toolchain-court.ts

| `benchRepository` | function | benchRepository(runs: number) |  |  |  |  |

| `benchSynthetic` | function | benchSynthetic(jobs: number, runs: number) |  |  |  |  |

| `syntheticSubjects` | function | syntheticSubjects(jobs: number, seed = 26926) |  |  |  |  |

| `BenchRow` | interface | interface BenchRow |  |  |  |  |


### scripts/bench-tui-thinking.ts

| `append` | method | append(delta: string) |  |  |  |  |

| `complete` | method | complete() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |


### scripts/check-package.ts

| `validatePackageTree` | function | validatePackageTree(base = root) |  |  |  |  |


### scripts/gen-ocel.ts

| `DEFAULT_PACK_ROOT` | const | DEFAULT_PACK_ROOT |  |  |  |  |

| `RELOCATION` | const | RELOCATION |  |  |  |  |

| `generateInto` | function | generateInto(work: string, ontologyPath = join(root, "ontology", "zcode-loop.ttl") |  |  |  |  |

| `ggenToml` | function | ggenToml(ontologyFile: string, env: Record<string, string | undefined> = process.env) |  |  |  |  |

| `packDir` | function | packDir(name: string, key: string, env: Record<string, string | undefined> = process.env) |  |  |  |  |

| `relocate` | function | relocate(work: string, dest: string) |  |  |  |  |


### scripts/pack-release.ts

| `packRelease` | function | packRelease(base = root) |  |  |  |  |

| `parsePackResult` | function | parsePackResult(stdout: string) |  |  |  |  |

| `validatePackResult` | function | validatePackResult(result: PackResult, packageJson: PackageIdentity) |  |  |  |  |

| `PackFile` | interface | interface PackFile |  |  |  |  |

| `PackResult` | interface | interface PackResult |  |  |  |  |


### scripts/package-contents.ts

| `attributionFiles` | const | attributionFiles |  |  |  |  |

| `pluginLicenseFiles` | const | pluginLicenseFiles |  |  |  |  |

| `publishedFiles` | const | publishedFiles |  |  |  |  |


### scripts/release-version.ts

| `compareReleaseVersions` | function | compareReleaseVersions(left: string, right: string) |  |  |  |  |

| `nextBuildVersion` | function | nextBuildVersion(currentVersion: string) |  |  |  |  |

| `parseReleaseVersion` | function | parseReleaseVersion(version: string) |  |  |  |  |

| `syncedReleaseVersion` | function | syncedReleaseVersion(appVersion: string, currentVersion: string) |  |  |  |  |

| `ReleaseVersion` | interface | interface ReleaseVersion |  |  |  |  |


### scripts/runtime-attribution.ts

| `runtimeModificationNotice` | const | runtimeModificationNotice |  |  |  |  |

| `markRuntimeModified` | function | markRuntimeModified(source: string) |  |  |  |  |


### scripts/smoke-package.ts

| `smokePackagedCli` | function | smokePackagedCli(tarball: string) |  |  |  |  |


### scripts/sync-runtime.ts

| `RuntimePatchError` | class | class RuntimePatchError |  |  |  |  |

| `defaultAgentAutoBackgroundMs` | const | defaultAgentAutoBackgroundMs |  |  |  |  |

| `runtimePatchPlan` | const | runtimePatchPlan |  |  |  |  |

| `sqliteBusyTimeoutMs` | const | sqliteBusyTimeoutMs |  |  |  |  |

| `chooseArtifact` | function | chooseArtifact(manifest: UpdateManifest, platform: SyncOptions["platform"]) |  |  |  |  |

| `extractRuntimeCapabilities` | function | extractRuntimeCapabilities(runtime: string) |  |  |  |  |

| `formatRuntimeCompatibilityFailure` | function | formatRuntimeCompatibilityFailure(report: RuntimeCompatibilityFailure) |  |  |  |  |

| `hasRuntimeAttachSessionMetadataNullGuard` | function | hasRuntimeAttachSessionMetadataNullGuard(runtime: string) |  |  |  |  |

| `hasRuntimeCliHelpContract` | function | hasRuntimeCliHelpContract(runtime: string) |  |  |  |  |

| `hasRuntimeHttpNoContentGuard` | function | hasRuntimeHttpNoContentGuard(runtime: string) |  |  |  |  |

| `hasRuntimeModelCatalogReload` | function | hasRuntimeModelCatalogReload(runtime: string) |  |  |  |  |

| `hasRuntimeNetworkRetryGuard` | function | hasRuntimeNetworkRetryGuard(runtime: string) |  |  |  |  |

| `hasRuntimeRegistryLoginModelDefaults` | function | hasRuntimeRegistryLoginModelDefaults(runtime: string) |  |  |  |  |

| `hasRuntimeSqliteBusyTimeout` | function | hasRuntimeSqliteBusyTimeout(runtime: string) |  |  |  |  |

| `hasRuntimeStreamEofFinishGuard` | function | hasRuntimeStreamEofFinishGuard(runtime: string) |  |  |  |  |

| `hasRuntimeTuiMetadataTurnNullGuard` | function | hasRuntimeTuiMetadataTurnNullGuard(runtime: string) |  |  |  |  |

| `installRuntimeProviderConfig` | function | installRuntimeProviderConfig(glm: string, nextVendor: string) |  |  |  |  |

| `manifestUrl` | function | manifestUrl(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `parseArgs` | function | parseArgs(argv: string[]) |  |  |  |  |

| `parseRuntimeLock` | function | parseRuntimeLock(value: unknown) |  |  |  |  |

| `parseRuntimePatchReports` | function | parseRuntimePatchReports(value: unknown) |  |  |  |  |

| `patchRuntimeAgentAutoBackground` | function | patchRuntimeAgentAutoBackground(runtime: string) |  |  |  |  |

| `patchRuntimeAttachSessionMetadataNullGuard` | function | patchRuntimeAttachSessionMetadataNullGuard(runtime: string) |  |  |  |  |

| `patchRuntimeBuiltinProviderAliases` | function | patchRuntimeBuiltinProviderAliases(runtime: string) |  |  |  |  |

| `patchRuntimeCliHelpContract` | function | patchRuntimeCliHelpContract(runtime: string) |  |  |  |  |

| `patchRuntimeDetachedAgentLifecycle` | function | patchRuntimeDetachedAgentLifecycle(runtime: string) |  |  |  |  |

| `patchRuntimeExpertStrategyConfig` | function | patchRuntimeExpertStrategyConfig(runtime: string) |  |  |  |  |

| `patchRuntimeGoalFailurePause` | function | patchRuntimeGoalFailurePause(runtime: string) |  |  |  |  |

| `patchRuntimeHttpNoContent` | function | patchRuntimeHttpNoContent(runtime: string) |  |  |  |  |

| `patchRuntimeLoginModelDefaults` | function | patchRuntimeLoginModelDefaults(runtime: string) |  |  |  |  |

| `patchRuntimeMaxTurnsEnforcement` | function | patchRuntimeMaxTurnsEnforcement(runtime: string) |  |  |  |  |

| `patchRuntimeModelCatalogReload` | function | patchRuntimeModelCatalogReload(runtime: string) |  |  |  |  |

| `patchRuntimeNetworkRetryClassification` | function | patchRuntimeNetworkRetryClassification(runtime: string) |  |  |  |  |

| `patchRuntimeOAuthHttpErrors` | function | patchRuntimeOAuthHttpErrors(runtime: string) |  |  |  |  |

| `patchRuntimeOfficialMcpAvailability` | function | patchRuntimeOfficialMcpAvailability(runtime: string) |  |  |  |  |

| `patchRuntimeSessionModelRecovery` | function | patchRuntimeSessionModelRecovery(runtime: string) |  |  |  |  |

| `patchRuntimeSharedConfig` | function | patchRuntimeSharedConfig(runtime: string) |  |  |  |  |

| `patchRuntimeSqliteBusyTimeout` | function | patchRuntimeSqliteBusyTimeout(runtime: string) |  |  |  |  |

| `patchRuntimeStreamEofFinishGuard` | function | patchRuntimeStreamEofFinishGuard(runtime: string) |  |  |  |  |

| `patchRuntimeStreamingLedgerForwarding` | function | patchRuntimeStreamingLedgerForwarding(runtime: string) |  |  |  |  |

| `patchRuntimeSubagentMaxTurns` | function | patchRuntimeSubagentMaxTurns(runtime: string) |  |  |  |  |

| `patchRuntimeTerminalToolProjection` | function | patchRuntimeTerminalToolProjection(runtime: string) |  |  |  |  |

| `patchRuntimeTuiBridge` | function | patchRuntimeTuiBridge(runtime: string) |  |  |  |  |

| `patchRuntimeTuiExecutionState` | function | patchRuntimeTuiExecutionState(runtime: string) |  |  |  |  |

| `patchRuntimeTuiMetadataTurnNullGuard` | function | patchRuntimeTuiMetadataTurnNullGuard(runtime: string) |  |  |  |  |

| `patchRuntimeZaiDesktopOAuth` | function | patchRuntimeZaiDesktopOAuth(runtime: string) |  |  |  |  |

| `resolveArtifactUrl` | function | resolveArtifactUrl(manifestHref: string, artifactHref: string) |  |  |  |  |

| `selectRuntimeLock` | function | selectRuntimeLock(candidate: RuntimeLock, current?: RuntimeLock) |  |  |  |  |

| `serviceManifestUrl` | function | serviceManifestUrl(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `serviceReleasePlatform` | function | serviceReleasePlatform(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `supportsMultiMessageFileRewind` | function | supportsMultiMessageFileRewind(runtime: string) |  |  |  |  |

| `RuntimeCompatibilityFailure` | interface | interface RuntimeCompatibilityFailure |  |  |  |  |

| `RuntimeLock` | interface | interface RuntimeLock |  |  |  |  |

| `RuntimeManifestResolution` | interface | interface RuntimeManifestResolution |  |  |  |  |

| `RuntimePatchDefinition` | interface | interface RuntimePatchDefinition |  |  |  |  |

| `RuntimePatchReport` | interface | interface RuntimePatchReport |  |  |  |  |

| `SyncOptions` | interface | interface SyncOptions |  |  |  |  |

| `RuntimePatchRequirement` | type | type RuntimePatchRequirement |  |  |  |  |

| `RuntimePatchStatus` | type | type RuntimePatchStatus |  |  |  |  |


### scripts/verify-tui-perf.ts

| `TUI_PERF_LIMITS` | const | TUI_PERF_LIMITS |  |  |  |  |

| `verifyTuiPerf` | function | verifyTuiPerf() |  |  |  |  |

| `TuiPerfGateResult` | interface | interface TuiPerfGateResult |  |  |  |  |


### scripts/workflow-toolchain-court.ts

| `compositeShell` | const | compositeShell |  |  |  |  |

| `dynamicScriptRef` | const | dynamicScriptRef |  |  |  |  |

| `inlinePinMarkers` | const | inlinePinMarkers |  |  |  |  |

| `pinnedLinuxX64Sha256` | const | pinnedLinuxX64Sha256 |  |  |  |  |

| `pinnedMarketplaceSha` | const | pinnedMarketplaceSha |  |  |  |  |

| `toolchainAction` | const | toolchainAction |  |  |  |  |

| `toolchainActionPath` | const | toolchainActionPath |  |  |  |  |

| `compositeCourt` | function | compositeCourt(action: CompositeAction) |  |  |  |  |

| `failureTolerated` | function | failureTolerated(subject: { "continue-on-error"?: boolean | string }) |  |  |  |  |

| `mutate` | function | mutate(subjects: WorkflowSubject[], name: string, edit: (source: string) |  |  |  |  |

| `packageScripts` | function | packageScripts() |  |  |  |  |

| `readToolchainAction` | function | readToolchainAction() |  |  |  |  |

| `readWorkflowSubjects` | function | readWorkflowSubjects() |  |  |  |  |

| `requireToolchainsValue` | function | requireToolchainsValue(value: unknown) |  |  |  |  |

| `requiresToolchain` | function | requiresToolchain(step: WorkflowStep, job: WorkflowJob, workflow: Workflow, scripts: Set<string>) |  |  |  |  |

| `scriptRefs` | function | scriptRefs(command: string) |  |  |  |  |

| `setsRequireToolchains` | function | setsRequireToolchains(command: string) |  |  |  |  |

| `toolchainCourt` | function | toolchainCourt(subjects: WorkflowSubject[], scripts: Set<string>) |  |  |  |  |

| `toolchainScripts` | function | toolchainScripts(scripts: Record<string, string>) |  |  |  |  |

| `CompositeAction` | interface | interface CompositeAction |  |  |  |  |

| `ToolchainViolation` | interface | interface ToolchainViolation |  |  |  |  |

| `Workflow` | interface | interface Workflow |  |  |  |  |

| `WorkflowJob` | interface | interface WorkflowJob |  |  |  |  |

| `WorkflowStep` | interface | interface WorkflowStep |  |  |  |  |

| `WorkflowSubject` | interface | interface WorkflowSubject |  |  |  |  |


### scripts/zcode-events.ts

| `runtimePath` | const | runtimePath |  |  |  |  |

| `readRuntimeEvents` | function | readRuntimeEvents(path = runtimePath) |  |  |  |  |

| `runtimeAvailable` | function | runtimeAvailable() |  |  |  |  |

| `wireOf` | function | wireOf(events: RuntimeEvents, internalValue: string) |  |  |  |  |

| `RuntimeEvents` | interface | interface RuntimeEvents |  |  |  |  |


### src/app-server-client.ts

| `AppServerCancellationError` | class | class AppServerCancellationError |  |  |  |  |

| `AppServerProcessError` | class | class AppServerProcessError |  |  |  |  |

| `AppServerRequestError` | class | class AppServerRequestError |  |  |  |  |

| `requestAppServer` | function | requestAppServer(request: AppServerRequest) |  |  |  |  |

| `AppServerRequest` | interface | interface AppServerRequest |  |  |  |  |

| `AppServerTransport` | interface | interface AppServerTransport |  |  |  |  |


### src/builtin-provider-families.ts

| `builtinCodingPlanFamilies` | const | builtinCodingPlanFamilies |  |  |  |  |

| `BuiltinCodingPlanFamily` | type | type BuiltinCodingPlanFamily |  |  |  |  |


### src/command.ts

| `captureCommand` | function | captureCommand(command: string, args: string[]) |  |  |  |  |

| `CommandResult` | interface | interface CommandResult |  |  |  |  |


### src/config-paths.ts

| `cliSettingsPath` | function | cliSettingsPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |

| `desktopSettingsPath` | function | desktopSettingsPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `legacyCliConfigPath` | function | legacyCliConfigPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerConfigPath` | function | providerConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |

| `providerMigrationMarkerPath` | function | providerMigrationMarkerPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `readDesktopSettings` | function | readDesktopSettings(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `settingsMigrationMarkerPath` | function | settingsMigrationMarkerPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `sharedDataBaseDir` | function | sharedDataBaseDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |


### src/darwin-oauth-callback.ts

| `DarwinUrlCallbackOptions` | interface | interface DarwinUrlCallbackOptions |  |  |  |  |

| `DarwinUrlCallbackReceiver` | interface | interface DarwinUrlCallbackReceiver |  |  |  |  |

| `CommandRunner` | type | type CommandRunner |  |  |  |  |


### src/evidence-cli.ts

| `runEvidenceCommand` | function | runEvidenceCommand(args: string[]) |  |  |  |  |

| `verifyEvidenceBundle` | function | verifyEvidenceBundle(path: string) |  |  |  |  |

| `EvidenceAdmissionReceipt` | interface | interface EvidenceAdmissionReceipt |  |  |  |  |


### src/execution-providers.ts

| `DEFAULT_EXECUTION_PROVIDER` | const | DEFAULT_EXECUTION_PROVIDER |  |  |  |  |

| `builtinExecutionProvider` | function | builtinExecutionProvider() |  |  |  |  |

| `parseExecutionProviderRegistry` | function | parseExecutionProviderRegistry(text: string) |  |  |  |  |

| `ExecutionProviderRead` | interface | interface ExecutionProviderRead |  |  |  |  |

| `ExecutionProviderRegistry` | interface | interface ExecutionProviderRegistry |  |  |  |  |

| `ExecutionProviderRule` | interface | interface ExecutionProviderRule |  |  |  |  |

| `ExecutionProviderSelection` | interface | interface ExecutionProviderSelection |  |  |  |  |

| `ReadConfigText` | type | type ReadConfigText |  |  |  |  |


### src/gall-cli.ts

| `runGallCommand` | function | runGallCommand(args: string[]) |  |  |  |  |

| `verifyGallBundle` | function | verifyGallBundle(bundleDir: string) |  |  |  |  |

| `verifyPortableGallArtifact` | function | verifyPortableGallArtifact(path: string) |  |  |  |  |

| `GallFreshConsumerReceipt` | interface | interface GallFreshConsumerReceipt |  |  |  |  |


### src/gall-work.ts

| `LeaseConflictError` | class | class LeaseConflictError |  |  |  |  |

| `defaultFabricUrl` | const | defaultFabricUrl |  |  |  |  |

| `gallWorkContractSha256` | const | gallWorkContractSha256 |  |  |  |  |

| `gallWorkUsage` | const | gallWorkUsage |  |  |  |  |

| `clearLeaseFiles` | function | clearLeaseFiles(cwd: string) |  |  |  |  |

| `constructPrompt` | function | constructPrompt(workOrderPathValue: string) |  |  |  |  |

| `gitHead` | function | gitHead(cwd: string) |  |  |  |  |

| `isGallWorkInvocation` | function | isGallWorkInvocation(args: string[]) |  |  |  |  |

| `leaseFilePaths` | function | leaseFilePaths(cwd: string) |  |  |  |  |

| `leaseFilePathsKeyed` | function | leaseFilePathsKeyed(cwd: string, leaseId: string | undefined) |  |  |  |  |

| `leaseIdFromEnv` | function | leaseIdFromEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `parseGallWorkArgs` | function | parseGallWorkArgs(args: string[], env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `parseGallWorkLease` | function | parseGallWorkLease(value: unknown) |  |  |  |  |

| `resolveFabricTarget` | function | resolveFabricTarget(env: NodeJS.ProcessEnv = process.env, configPath?: string) |  |  |  |  |

| `saveLeaseFiles` | function | saveLeaseFiles(cwd: string, claim: Record<string, unknown>) |  |  |  |  |

| `standingForOutcome` | function | standingForOutcome(outcome: string) |  |  |  |  |

| `workOrderPath` | function | workOrderPath(cwd: string) |  |  |  |  |

| `ConstructOutcome` | interface | interface ConstructOutcome |  |  |  |  |

| `ConstructRunOptions` | interface | interface ConstructRunOptions |  |  |  |  |

| `FabricCallOutcome` | interface | interface FabricCallOutcome |  |  |  |  |

| `FabricCapabilities` | interface | interface FabricCapabilities |  |  |  |  |

| `FabricTarget` | interface | interface FabricTarget |  |  |  |  |

| `GallWorkIo` | interface | interface GallWorkIo |  |  |  |  |

| `GallWorkLease` | interface | interface GallWorkLease |  |  |  |  |

| `GallWorkRequest` | interface | interface GallWorkRequest |  |  |  |  |

| `GallWorkResult` | interface | interface GallWorkResult |  |  |  |  |

| `LeaseReconciliation` | interface | interface LeaseReconciliation |  |  |  |  |

| `ConstructOverride` | type | type ConstructOverride |  |  |  |  |

| `FabricCall` | type | type FabricCall |  |  |  |  |

| `FetchLike` | type | type FetchLike |  |  |  |  |

| `LifecycleEmit` | type | type LifecycleEmit |  |  |  |  |


### src/generated/loop.ts

| `CHAIN_ALGO` | const | CHAIN_ALGO |  |  |  |  |

| `MxLoopInitial` | const | MxLoopInitial |  |  |  |  |

| `MxLoopTransitions` | const | MxLoopTransitions |  |  |  |  |

| `ZcodeTurnInitial` | const | ZcodeTurnInitial |  |  |  |  |

| `ZcodeTurnTransitions` | const | ZcodeTurnTransitions |  |  |  |  |

| `MxLoopState` | enum | enum MxLoopState |  |  |  |  |

| `ZcodeTurnState` | enum | enum ZcodeTurnState |  |  |  |  |

| `chainDigest` | function | chainDigest(data: string) |  |  |  |  |

| `chainEvents` | function | chainEvents(events: ReadonlyArray<string>) |  |  |  |  |

| `replayMxLoop` | function | replayMxLoop(events: ReadonlyArray<TransitionEvent>) |  |  |  |  |

| `replayZcodeTurn` | function | replayZcodeTurn(events: ReadonlyArray<TransitionEvent>) |  |  |  |  |

| `stepMxLoop` | function | stepMxLoop(state: MxLoopState, name: string, ctx: Record<string, boolean>) |  |  |  |  |

| `stepZcodeTurn` | function | stepZcodeTurn(state: ZcodeTurnState, name: string, ctx: Record<string, boolean>) |  |  |  |  |

| `TransitionEvent` | type | type TransitionEvent |  |  |  |  |

| `Violation` | type | type Violation |  |  |  |  |


### src/generated/ocel.ts

| `Tap` | class | class Tap |  |  |  |  |

| `CALLBACK_KINDS` | const | CALLBACK_KINDS |  |  |  |  |

| `CLOSES` | const | CLOSES |  |  |  |  |

| `EVENT_TYPES` | const | EVENT_TYPES |  |  |  |  |

| `OBJECT_TYPES` | const | OBJECT_TYPES |  |  |  |  |

| `PHASED` | const | PHASED |  |  |  |  |

| `PHASE_CLOSE` | const | PHASE_CLOSE |  |  |  |  |

| `PHASE_OPEN` | const | PHASE_OPEN |  |  |  |  |

| `RULES` | const | RULES |  |  |  |  |

| `SOURCES` | const | SOURCES |  |  |  |  |

| `SUPPORTED_HASHES` | const | SUPPORTED_HASHES |  |  |  |  |

| `canon` | function | canon(e: { id: string; type: string; time: string; relationships: Relationship[] }, phase = "", ref = "") |  |  |  |  |

| `hashHex` | function | hashHex(alg: string, data: string) |  |  |  |  |

| `verifyChain` | function | verifyChain(doc: OcelDoc, alg: string) |  |  |  |  |

| `append` | method | append(raw0: unknown) |  |  |  |  |

| `attr` | method | attr(e: OcelEvent, n: string) |  |  |  |  |

| `closedRefs` | method | closedRefs() |  |  |  |  |

| `ingest` | method | ingest(input: string | object) |  |  |  |  |

| `openPending` | method | openPending(outcome: string, rels: Relationship[]) |  |  |  |  |

| `seal` | method | seal() |  |  |  |  |

| `serialize` | method | serialize() |  |  |  |  |

| `toOcel` | method | toOcel() |  |  |  |  |

| `unpaired` | method | unpaired() |  |  |  |  |

| `Attribute` | type | type Attribute |  |  |  |  |

| `OcelDoc` | type | type OcelDoc |  |  |  |  |

| `OcelEvent` | type | type OcelEvent |  |  |  |  |

| `Relationship` | type | type Relationship |  |  |  |  |

| `RuleSpec` | type | type RuleSpec |  |  |  |  |

| `SourceSpec` | type | type SourceSpec |  |  |  |  |


### src/generated/receipt.ts

| `ALGORITHM` | const | ALGORITHM |  |  |  |  |

| `FIELDS` | const | FIELDS |  |  |  |  |

| `GENESIS` | const | GENESIS |  |  |  |  |

| `NEUTRAL` | const | NEUTRAL |  |  |  |  |

| `PHASES` | const | PHASES |  |  |  |  |

| `STANDINGS` | const | STANDINGS |  |  |  |  |

| `isSealed` | const | isSealed |  |  |  |  |

| `appendOutcome` | function | appendOutcome(chain: Chain, entry_id: string, standing: string, subject: string, action: string) |  |  |  |  |

| `appendPending` | function | appendPending(chain: Chain, entry_id: string, subject: string, action: string) |  |  |  |  |

| `canonical` | function | canonical(e: Record<string, unknown>) |  |  |  |  |

| `digest` | function | digest(text: string) |  |  |  |  |

| `seal` | function | seal(chain: Chain, entry_id: string, standing: string, subject: string) |  |  |  |  |

| `unpaired` | function | unpaired(chain: Chain) |  |  |  |  |

| `verify` | function | verify(chain: Chain) |  |  |  |  |

| `Entry` | interface | interface Entry |  |  |  |  |

| `Chain` | type | type Chain |  |  |  |  |


### src/launcher.ts

| `firstRunSetupEnv` | function | firstRunSetupEnv(setupPending: boolean, args: string[]) |  |  |  |  |

| `formatVersionOutput` | function | formatVersionOutput(distributionVersion: string, runtimeVersion: string) |  |  |  |  |

| `isVersionInvocation` | function | isVersionInvocation(args: string[]) |  |  |  |  |

| `main` | function | main(args: string[]) |  |  |  |  |

| `normalizeLoginArgs` | function | normalizeLoginArgs(args: string[]) |  |  |  |  |

| `readDistributionVersion` | function | readDistributionVersion(manifestPath = packageManifestPath) |  |  |  |  |

| `readRuntimeVersion` | function | readRuntimeVersion(metadataPath = extractionMetadataPath) |  |  |  |  |

| `resolveModelRetryMaxRetries` | function | resolveModelRetryMaxRetries(env: NodeJS.ProcessEnv) |  |  |  |  |

| `resolveNodeExecutable` | function | resolveNodeExecutable() |  |  |  |  |

| `resolveZCodeBaseUrl` | function | resolveZCodeBaseUrl(env: NodeJS.ProcessEnv) |  |  |  |  |


### src/max-turns.ts

| `extractMaxTurns` | function | extractMaxTurns(args: string[]) |  |  |  |  |

| `readSubagentMaxTurnsSetting` | function | readSubagentMaxTurnsSetting(settingsPath: string) |  |  |  |  |

| `resolveSubagentMaxTurnsEnv` | function | resolveSubagentMaxTurnsEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `MaxTurnsExtraction` | interface | interface MaxTurnsExtraction |  |  |  |  |


### src/model-access.ts

| `hasConfiguredProviderAccess` | function | hasConfiguredProviderAccess(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerConfigPathHint` | function | providerConfigPathHint(platform: NodeJS.Platform = process.platform) |  |  |  |  |

| `readConfiguredModelAccess` | function | readConfiguredModelAccess(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `CliSettingsBootstrapResult` | interface | interface CliSettingsBootstrapResult |  |  |  |  |

| `ConfiguredModelAccess` | interface | interface ConfiguredModelAccess |  |  |  |  |

| `CliSettingsRecord` | type | type CliSettingsRecord |  |  |  |  |


### src/ocel-tap.ts

| `OcelRecorder` | class | class OcelRecorder |  |  |  |  |

| `APP_SERVER_SOURCE` | const | APP_SERVER_SOURCE |  |  |  |  |

| `GALL_WORK_SOURCE` | const | GALL_WORK_SOURCE |  |  |  |  |

| `STREAM_SOURCE` | const | STREAM_SOURCE |  |  |  |  |

| `leaseIdentityFromEnv` | function | leaseIdentityFromEnv(env: NodeJS.ProcessEnv) |  |  |  |  |

| `normalizeRecord` | function | normalizeRecord(record: unknown) |  |  |  |  |

| `ocelDirectory` | function | ocelDirectory(env: NodeJS.ProcessEnv) |  |  |  |  |

| `ocelEnabled` | function | ocelEnabled(env: NodeJS.ProcessEnv) |  |  |  |  |

| `ocelSourceForArgs` | function | ocelSourceForArgs(args: readonly string[]) |  |  |  |  |

| `redactSecrets` | function | redactSecrets(text: string) |  |  |  |  |

| `sessionOf` | function | sessionOf(record: unknown) |  |  |  |  |

| `startOcelTap` | function | startOcelTap(args: readonly string[], env: NodeJS.ProcessEnv) |  |  |  |  |

| `subjectHead` | function | subjectHead(cwd: string | undefined) |  |  |  |  |

| `toEx4pmReceipt` | function | toEx4pmReceipt(entry: Entry) |  |  |  |  |

| `LeaseIdentity` | interface | interface LeaseIdentity |  |  |  |  |

| `feed` | method | feed(record: unknown) |  |  |  |  |

| `feedLine` | method | feedLine(line: string) |  |  |  |  |

| `finish` | method | finish() |  |  |  |  |

| `write` | method | write(chunk: string) |  |  |  |  |

| `OcelResult` | type | type OcelResult |  |  |  |  |


### src/parts-cli.ts

| `inspectSemanticPart` | function | inspectSemanticPart(graphValue: unknown, partRef: string) |  |  |  |  |

| `runPartsCommand` | function | runPartsCommand(args: string[]) |  |  |  |  |

| `PartAlternative` | interface | interface PartAlternative |  |  |  |  |

| `SemanticFalsifierResult` | interface | interface SemanticFalsifierResult |  |  |  |  |


### src/plugin-cli.ts

| `PluginRequestInput` | interface | interface PluginRequestInput |  |  |  |  |

| `RunPluginCommandOptions` | interface | interface RunPluginCommandOptions |  |  |  |  |


### src/plugin-protocol.ts

| `pluginProtocolMethods` | const | pluginProtocolMethods |  |  |  |  |

| `pluginWorkspace` | function | pluginWorkspace(path: string) |  |  |  |  |

| `PluginReferenceCatalogResult` | interface | interface PluginReferenceCatalogResult |  |  |  |  |

| `PluginReferenceSummary` | interface | interface PluginReferenceSummary |  |  |  |  |

| `PluginWorkspace` | interface | interface PluginWorkspace |  |  |  |  |


### src/provider-backoff.ts

| `ConcurrencyCap` | class | class ConcurrencyCap |  |  |  |  |

| `ProviderCapacityRefusal` | class | class ProviderCapacityRefusal |  |  |  |  |

| `defaultBackoffPolicy` | const | defaultBackoffPolicy |  |  |  |  |

| `defaultFabricConcurrencyLimit` | const | defaultFabricConcurrencyLimit |  |  |  |  |

| `capacityFromBody` | function | capacityFromBody(body: unknown) |  |  |  |  |

| `capacityFromStatus` | function | capacityFromStatus(status: number) |  |  |  |  |

| `isProviderCapacityRefusal` | function | isProviderCapacityRefusal(value: unknown) |  |  |  |  |

| `BackoffPolicy` | interface | interface BackoffPolicy |  |  |  |  |

| `CallWithCapacityBackoffOptions` | interface | interface CallWithCapacityBackoffOptions |  |  |  |  |

| `CapacitySignal` | interface | interface CapacitySignal |  |  |  |  |

| `inFlightCount` | method | inFlightCount() |  |  |  |  |

| `CapacityCode` | type | type CapacityCode |  |  |  |  |


### src/relay-admission.ts

| `RelayLockError` | class | class RelayLockError |  |  |  |  |

| `RelayStateError` | class | class RelayStateError |  |  |  |  |

| `RelayWorker` | class | class RelayWorker |  |  |  |  |

| `ADMISSION_ORDER` | const | ADMISSION_ORDER |  |  |  |  |

| `KNOWN_REPLAY` | const | KNOWN_REPLAY |  |  |  |  |

| `RELAY_ACTUATE_VERB` | const | RELAY_ACTUATE_VERB |  |  |  |  |

| `RELAY_ALLOW_DO_ENV` | const | RELAY_ALLOW_DO_ENV |  |  |  |  |

| `RELAY_CHANNELS` | const | RELAY_CHANNELS |  |  |  |  |

| `RELAY_CONTRACT` | const | RELAY_CONTRACT |  |  |  |  |

| `RELAY_CONTRACT_VERSION` | const | RELAY_CONTRACT_VERSION |  |  |  |  |

| `RELAY_ENVELOPE_REQUIRED` | const | RELAY_ENVELOPE_REQUIRED |  |  |  |  |

| `RELAY_ENVELOPE_SCHEMA` | const | RELAY_ENVELOPE_SCHEMA |  |  |  |  |

| `RELAY_OCEL_IDENTITY_ENV` | const | RELAY_OCEL_IDENTITY_ENV |  |  |  |  |

| `RELAY_REFUSALS` | const | RELAY_REFUSALS |  |  |  |  |

| `RELAY_STATE_SCHEMA` | const | RELAY_STATE_SCHEMA |  |  |  |  |

| `RELAY_STATE_SCHEMA_V1` | const | RELAY_STATE_SCHEMA_V1 |  |  |  |  |

| `defaultRelayStateDir` | const | defaultRelayStateDir |  |  |  |  |

| `checkAuthorityShape` | function | checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean) |  |  |  |  |

| `checkEnvelopeShape` | function | checkEnvelopeShape(value: unknown) |  |  |  |  |

| `checkExecutionManifest` | function | checkExecutionManifest(envelope: RelayEnvelope, sessionManifest: string) |  |  |  |  |

| `checkExpiry` | function | checkExpiry(envelope: RelayEnvelope, nowMs: number) |  |  |  |  |

| `checkGallWorkBinding` | function | checkGallWorkBinding(envelope: RelayEnvelope, descriptor: unknown) |  |  |  |  |

| `commandIdDigest` | function | commandIdDigest(commandId: string) |  |  |  |  |

| `localAllowDoFromEnv` | function | localAllowDoFromEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `relayIdentityEnv` | function | relayIdentityEnv(descriptor: RelayLeaseDescriptor) |  |  |  |  |

| `relayStatePath` | function | relayStatePath(stateDir: string, worktree: string, epochId: string) |  |  |  |  |

| `AckedCommand` | interface | interface AckedCommand |  |  |  |  |

| `PendingCommand` | interface | interface PendingCommand |  |  |  |  |

| `RelayAckState` | interface | interface RelayAckState |  |  |  |  |

| `RelayEnvelope` | interface | interface RelayEnvelope |  |  |  |  |

| `RelayLeaseDescriptor` | interface | interface RelayLeaseDescriptor |  |  |  |  |

| `RelayWorkerOptions` | interface | interface RelayWorkerOptions |  |  |  |  |

| `acknowledge` | method | acknowledge(commandId: string, receiptRef: string | null = null) |  |  |  |  |

| `acknowledgeDurable` | method | acknowledgeDurable(commandId: string, receiptRef: string | null) |  |  |  |  |

| `admit` | method | admit(raw: unknown) |  |  |  |  |

| `snapshot` | method | snapshot() |  |  |  |  |

| `AckResult` | type | type AckResult |  |  |  |  |

| `AdmissionResult` | type | type AdmissionResult |  |  |  |  |

| `AdmissionStage` | type | type AdmissionStage |  |  |  |  |

| `RelayChannel` | type | type RelayChannel |  |  |  |  |

| `RelayDispatchResult` | type | type RelayDispatchResult |  |  |  |  |

| `RelayRefusal` | type | type RelayRefusal |  |  |  |  |


### src/research-runtime/doctrine/command-topology.ts

| `CommandNode` | interface | interface CommandNode |  |  |  |  |


### src/research-runtime/doctrine/intent.ts

| `Intent` | interface | interface Intent |  |  |  |  |


### src/research-runtime/evidence/osiris-boundary.ts

| `boundedCompanion` | const | boundedCompanion |  |  |  |  |


### src/research-runtime/evolution/racap.ts

| `PairedWorld` | interface | interface PairedWorld |  |  |  |  |


### src/research-runtime/evolution/survival.ts

| `SurvivalEvidence` | interface | interface SurvivalEvidence |  |  |  |  |


### src/research-runtime/federation/query-contract.ts

| `QueryContract` | interface | interface QueryContract |  |  |  |  |


### src/research-runtime/federation/source-binding.ts

| `SourceBinding` | interface | interface SourceBinding |  |  |  |  |


### src/research-runtime/graphlaw/invariant.ts

| `Invariant` | interface | interface Invariant |  |  |  |  |


### src/research-runtime/graphlaw/migration.ts

| `Migration` | interface | interface Migration |  |  |  |  |


### src/research-runtime/graphlaw/semantic-part.ts

| `SemanticPart` | interface | interface SemanticPart |  |  |  |  |


### src/research-runtime/identity/authority.ts

| `Authority` | type | type Authority |  |  |  |  |


### src/research-runtime/identity/exact-subject.ts

| `ExactSubject` | interface | interface ExactSubject |  |  |  |  |


### src/research-runtime/identity/standing.ts

| `Standing` | type | type Standing |  |  |  |  |


### src/research-runtime/interchange/edge.ts

| `Edge` | interface | interface Edge |  |  |  |  |


### src/research-runtime/intervention/budget.ts

| `AttemptBudget` | class | class AttemptBudget |  |  |  |  |


### src/research-runtime/intervention/work-order.ts

| `WorkOrder` | interface | interface WorkOrder |  |  |  |  |


### src/research-runtime/ocel/event.ts

| `OcelEvent` | interface | interface OcelEvent |  |  |  |  |


### src/research-runtime/ocel/receipt.ts

| `ExecutionReceipt` | interface | interface ExecutionReceipt |  |  |  |  |


### src/research-runtime/planning/hddl.ts

| `Task` | interface | interface Task |  |  |  |  |


### src/research-runtime/planning/powl.ts

| `Event` | interface | interface Event |  |  |  |  |


### src/research-runtime/ptd/epoch.ts

| `Epoch` | interface | interface Epoch |  |  |  |  |


### src/research-runtime/ptd/experiment.ts

| `EpochResult` | interface | interface EpochResult |  |  |  |  |


### src/research-runtime/sa2a/admission.ts

| `admitPortable` | function | admitPortable(value:unknown) |  |  |  |  |

| `Admission` | type | type Admission |  |  |  |  |


### src/research-runtime/sa2a/attempt-budget.ts

| `AttemptBudget` | class | class AttemptBudget |  |  |  |  |

| `consume` | method | consume() |  |  |  |  |

| `remaining` | method | remaining() |  |  |  |  |


### src/research-runtime/sa2a/contract.ts

| `SA2A_REPLAN_VERSION` | const | SA2A_REPLAN_VERSION |  |  |  |  |

| `isSa2aEnvelope` | const | isSa2aEnvelope |  |  |  |  |

| `Sa2aReplanEnvelope` | interface | interface Sa2aReplanEnvelope |  |  |  |  |

| `RecoveryDecision` | type | type RecoveryDecision |  |  |  |  |


### src/research-runtime/sa2a/failover.ts

| `FailoverResult` | interface | interface FailoverResult |  |  |  |  |


### src/research-runtime/sa2a/identity.ts

| `canonicalSubject` | const | canonicalSubject |  |  |  |  |

| `exactEnvelopeIdentity` | const | exactEnvelopeIdentity |  |  |  |  |

| `subjectDigest` | const | subjectDigest |  |  |  |  |


### src/research-runtime/sa2a/ocel-feedback.ts

| `toOcelRecoveryEvent` | function | toOcelRecoveryEvent(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `OcelRecoveryEvent` | interface | interface OcelRecoveryEvent |  |  |  |  |


### src/research-runtime/sa2a/provider-health.ts

| `providerIsSelectable` | const | providerIsSelectable |  |  |  |  |

| `recordProviderOutcome` | const | recordProviderOutcome |  |  |  |  |

| `ProviderHealthState` | interface | interface ProviderHealthState |  |  |  |  |

| `ProviderHealth` | type | type ProviderHealth |  |  |  |  |


### src/research-runtime/sa2a/provider.ts

| `CandidateProviderRegistry` | class | class CandidateProviderRegistry |  |  |  |  |

| `CandidateProvider` | interface | interface CandidateProvider |  |  |  |  |

| `excluding` | method | excluding(ids: ReadonlySet<string>) |  |  |  |  |

| `get` | method | get(id: string) |  |  |  |  |

| `register` | method | register(provider: CandidateProvider) |  |  |  |  |


### src/research-runtime/sa2a/receipt-feedback.ts

| `applyReceiptFeedback` | function | applyReceiptFeedback(envelope: Sa2aReplanEnvelope, receipt: Sa2aPortableReceipt) |  |  |  |  |

| `Sa2aPortableReceipt` | interface | interface Sa2aPortableReceipt |  |  |  |  |


### src/research-runtime/sa2a/reconciliation.ts

| `reconcileOutcome` | function | reconcileOutcome(envelope: Sa2aReplanEnvelope) |  |  |  |  |


### src/research-runtime/sa2a/recovery.ts

| `recoveryDecision` | function | recoveryDecision(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `withRecovery` | function | withRecovery(envelope: Sa2aReplanEnvelope) |  |  |  |  |


### src/research-runtime/sa2a/replay.ts

| `assertReplayStable` | function | assertReplayStable(previous:Sa2aReplanEnvelope,next:Sa2aReplanEnvelope) |  |  |  |  |


### src/research-runtime/sa2a/runtime.ts

| `runPortableRecoveryRuntime` | function | runPortableRecoveryRuntime(input: PortableRecoveryRuntimeInput) |  |  |  |  |

| `PortableRecoveryRuntimeInput` | interface | interface PortableRecoveryRuntimeInput |  |  |  |  |

| `PortableRecoveryRuntimeResult` | interface | interface PortableRecoveryRuntimeResult |  |  |  |  |


### src/research-runtime/sa2a/stale.ts

| `SubjectSnapshot` | type | type SubjectSnapshot |  |  |  |  |


### src/research-runtime/trimtab/context-window.ts

| `ContextItem` | interface | interface ContextItem |  |  |  |  |


### src/research-runtime/trimtab/model-role.ts

| `modelRole` | const | modelRole |  |  |  |  |


### src/research-runtime/wasm/contract.ts

| `PortableCapability` | interface | interface PortableCapability |  |  |  |  |


### src/runtime-capabilities.ts

| `capabilitiesFromExtractionMetadata` | function | capabilitiesFromExtractionMetadata(value: unknown) |  |  |  |  |

| `parseRuntimeCapabilities` | function | parseRuntimeCapabilities(value: unknown) |  |  |  |  |

| `RuntimeCapabilities` | interface | interface RuntimeCapabilities |  |  |  |  |

| `RuntimeCliOptionCapability` | interface | interface RuntimeCliOptionCapability |  |  |  |  |

| `RuntimeCliOptionType` | type | type RuntimeCliOptionType |  |  |  |  |


### src/runtime-config-bridge.ts

| `mergeDesktopSettings` | function | mergeDesktopSettings(value: unknown, filePath: string, env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerMigrationNeeded` | function | providerMigrationNeeded(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerRegistryContainsFamilyKey` | function | providerRegistryContainsFamilyKey(registryConfig: unknown, family: string) |  |  |  |  |


### src/runtime-node.ts

| `resolveRuntimeNode` | function | resolveRuntimeNode(override: string | undefined) |  |  |  |  |


### src/session-model-recovery.ts

| `SessionModelState` | interface | interface SessionModelState |  |  |  |  |


### src/update-check.ts

| `UPDATE_CACHE_TTL_MS` | const | UPDATE_CACHE_TTL_MS |  |  |  |  |

| `UPDATE_CHECK_URL` | const | UPDATE_CHECK_URL |  |  |  |  |

| `refreshUpdateCache` | function | refreshUpdateCache(options: RefreshUpdateCacheOptions) |  |  |  |  |

| `updateCheckDisabled` | function | updateCheckDisabled(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `ReadStartupUpdateOptions` | interface | interface ReadStartupUpdateOptions |  |  |  |  |

| `RefreshUpdateCacheOptions` | interface | interface RefreshUpdateCacheOptions |  |  |  |  |

| `StartupUpdateCheck` | interface | interface StartupUpdateCheck |  |  |  |  |

| `UpdateFetcher` | type | type UpdateFetcher |  |  |  |  |


### src/zai-oauth.ts

| `buildZaiAuthorizeUrl` | function | buildZaiAuthorizeUrl(state: string) |  |  |  |  |

| `classifyZaiOAuthInvocation` | function | classifyZaiOAuthInvocation(args: string[]) |  |  |  |  |

| `parseZaiOAuthCallback` | function | parseZaiOAuthCallback(callbackUrl: string, expectedState: string) |  |  |  |  |

| `runZaiOAuthLogin` | function | runZaiOAuthLogin(options: ZaiOAuthLoginOptions) |  |  |  |  |

| `OfficialLoginPayload` | interface | interface OfficialLoginPayload |  |  |  |  |

| `ZaiOAuthCallback` | interface | interface ZaiOAuthCallback |  |  |  |  |

| `ZaiOAuthInvocation` | interface | interface ZaiOAuthInvocation |  |  |  |  |

| `ZaiOAuthLoginOptions` | interface | interface ZaiOAuthLoginOptions |  |  |  |  |


### zcode-app-cli

| `zcode` | bin | bin/zcode.js |  |  |  |  |

| `bench:tui-memory` | script | bun --expose-gc scripts/bench-tui-memory.ts |  |  |  |  |

| `bench:tui-stream` | script | bun scripts/bench-tui-stream.ts |  |  |  |  |

| `bench:tui-thinking` | script | bun scripts/bench-tui-thinking.ts |  |  |  |  |

| `build` | script | node node_modules/.bin/tsdown |  |  |  |  |

| `build:launcher` | script | node node_modules/.bin/tsdown --filter launcher |  |  |  |  |

| `build:tui` | script | node node_modules/.bin/tsdown --filter tui |  |  |  |  |

| `check` | script | bun run build && bun scripts/check-runtime.ts |  |  |  |  |

| `check:oauth-callback` | script | bun scripts/smoke-oauth-callback.ts |  |  |  |  |

| `check:tui` | script | bun scripts/smoke-tui.ts && bun scripts/smoke-tui-features.ts && bun scripts/smoke-tui-clear.ts && bun scripts/smoke-tui-session-title.ts && bun scripts/smoke-tui-pressure.ts && bun scripts/smoke-tui-widths.ts && bun scripts/smoke-tui-fullscreen.ts && bun scripts/smoke-tui-fullscreen-switch.ts && bun scripts/smoke-tui-fullscreen-layout.ts |  |  |  |  |

| `check:tui-scenarios` | script | bun run test:tui |  |  |  |  |

| `dev` | script | bun run sync:local && ZCODE_NODE=node bun bin/zcode.ts |  |  |  |  |

| `prepack` | script | bun scripts/check-package.ts --prepack |  |  |  |  |

| `receipts:validate` | script | bun scripts/validate-receipts.ts |  |  |  |  |

| `release:build` | script | bun scripts/build-release.ts |  |  |  |  |

| `release:pack` | script | bun scripts/pack-release.ts |  |  |  |  |

| `release:prepare` | script | bun scripts/build-release.ts --latest |  |  |  |  |

| `sync` | script | bun run build && bun scripts/sync-runtime.ts |  |  |  |  |

| `sync:local` | script | bun run build && bun scripts/sync-runtime.ts --app $HOME/Applications/ZCode.app |  |  |  |  |

| `sync:locked` | script | bun run build && bun scripts/sync-runtime.ts --lock zcode-runtime.lock.json && ZCODE_REQUIRE_TOOLCHAINS=1 ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-anchor-drift.test.ts test/sync-runtime-loop-gaps.test.ts |  |  |  |  |

| `test` | script | bun run test:unit |  |  |  |  |

| `test:all` | script | bun run test:unit && bun run test:tui && bun run test:runtime && bun run test:node |  |  |  |  |

| `test:capability-snapshot` | script | bun test test/capability-snapshot.test.ts |  |  |  |  |

| `test:fast` | script | bun run test:unit |  |  |  |  |

| `test:live` | script | bun test test/live/ |  |  |  |  |

| `test:node` | script | node --test test/node/*.test.cjs |  |  |  |  |

| `test:runtime` | script | ZCODE_REQUIRE_TOOLCHAINS=1 bun test test/runtime/*.test.ts |  |  |  |  |

| `test:tui` | script | bun run test:tui:component && bun run test:tui:e2e |  |  |  |  |

| `test:tui-scenario` | script | bun scripts/tui-scenario.ts |  |  |  |  |

| `test:tui:component` | script | bun test test/tui/scenario-http.test.ts test/tui/scenario-runtime.test.ts test/tui/scenario-shell.test.ts test/tui/scenario-workspace.test.ts test/tui/terminal-screen.test.ts |  |  |  |  |

| `test:tui:e2e` | script | bun test test/tui/allowlisted-shell.test.ts test/tui/http-mock.test.ts test/tui/model-resume.test.ts test/tui/permission-request-queue.test.ts test/tui/run-scenario.test.ts test/tui/session-rename.test.ts test/tui/terminal-session.test.ts test/tui/write-and-diff.test.ts |  |  |  |  |

| `test:tui:host` | script | bun test test/tui/scenario-mountx.test.ts |  |  |  |  |

| `test:tui:manual` | script | bun scripts/tui-scenario.ts --manual |  |  |  |  |

| `test:unit` | script | ZCODE_REQUIRE_TOOLCHAINS=1 bun test test/*.test.ts |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `verify:tui-perf` | script | bun scripts/verify-tui-perf.ts |  |  |  |  |

| `version:build` | script | bun scripts/bump-build.ts |  |  |  |  |



<!-- AGENT-FORBIDDEN-END -->

## Signature/type/default/errors table

<!-- RIGID table: header order is fixed; rows come only from the query. -->

| Item | Type | Signature | Params | Defaults | Errors | Invariants |
|------|------|-----------|--------|----------|--------|------------|

| `android-emulator-mcp` | bin | ./dist/mcp/server.js |  |  |  |  |

| `build` | script | tsc && node scripts/build-mcp.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `build` | script | tsc && node scripts/build.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `lint` | script | oxlint src --no-ignore |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `ios-simulator-mcp` | bin | ./dist/mcp/server.js |  |  |  |  |

| `build` | script | tsc && node scripts/build-mcp.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `build` | script | tsc && node scripts/build.mjs |  |  |  |  |

| `lint` | script | oxlint src --no-ignore |  |  |  |  |

| `test` | script | vitest run test |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `test` | script | node --test test/*.test.mjs |  |  |  |  |

| `test:integration` | script | node test/dev-workflow.integration.mjs ../cli/dist/zcode.cjs |  |  |  |  |

| `build` | script | node scripts/check-sdk.mjs |  |  |  |  |

| `bump:producer` | script | node scripts/bump-zcode-cua-producer.mjs |  |  |  |  |

| `check:baseline` | script | node scripts/check-cua-baseline.mjs |  |  |  |  |

| `clean` | script | node ../../scripts/clean-dist.mjs |  |  |  |  |

| `sync:all` | script | pnpm sync:skill && pnpm sync:version && pnpm build && pnpm sync:cache |  |  |  |  |

| `sync:cache` | script | node scripts/sync-cache.mjs |  |  |  |  |

| `sync:skill` | script | node scripts/sync-skill-from-zcode-cua.mjs |  |  |  |  |

| `sync:version` | script | node scripts/check-version-coherence.mjs |  |  |  |  |

| `test` | script | pnpm run build && node --test tests/*.node-test.mjs |  |  |  |  |

| `typecheck` | script | node scripts/check-sdk.mjs |  |  |  |  |

| `version:check` | script | node scripts/check-version-coherence.mjs --check |  |  |  |  |

| `AssistantStream` | class | class AssistantStream |  |  |  |  |

| `append` | method | append(delta: string, partId?: string, messageId?: string) |  |  |  |  |

| `beginTurn` | method | beginTurn() |  |  |  |  |

| `breakSegment` | method | breakSegment() |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `ensurePartSegment` | method | ensurePartSegment(partId: string, messageId?: string) |  |  |  |  |

| `reconcile` | method | reconcile(response: string) |  |  |  |  |

| `removePart` | method | removePart(partId: string) |  |  |  |  |

| `upsert` | method | upsert(text: string, partId: string, messageId?: string) |  |  |  |  |

| `AttachmentBar` | class | class AttachmentBar |  |  |  |  |

| `AttachmentBarCallbacks` | interface | interface AttachmentBarCallbacks |  |  |  |  |

| `activate` | method | activate(index = this.attachments.length - 1) |  |  |  |  |

| `compactLine` | method | compactLine(width: number) |  |  |  |  |

| `deactivate` | method | deactivate() |  |  |  |  |

| `getSelectedIndex` | method | getSelectedIndex() |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isActive` | method | isActive() |  |  |  |  |

| `moveSelection` | method | moveSelection(delta: -1 | 1) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setAttachments` | method | setAttachments(attachments: PromptImageAttachment[]) |  |  |  |  |

| `token` | method | token(index: number) |  |  |  |  |

| `withInactiveHint` | method | withInactiveHint(line: string, width: number) |  |  |  |  |

| `attachmentSummary` | function | attachmentSummary(attachments: PromptImageAttachment[]) |  |  |  |  |

| `clipboardImageAttachment` | function | clipboardImageAttachment(value: unknown) |  |  |  |  |

| `promptInput` | function | promptInput(text: string, attachments: PromptImageAttachment[]) |  |  |  |  |

| `PromptImageAttachment` | interface | interface PromptImageAttachment |  |  |  |  |

| `BackgroundTaskEventStore` | class | class BackgroundTaskEventStore |  |  |  |  |

| `TaskActivityEntry` | interface | interface TaskActivityEntry |  |  |  |  |

| `TaskEventNotice` | interface | interface TaskEventNotice |  |  |  |  |

| `TaskEventUpdate` | interface | interface TaskEventUpdate |  |  |  |  |

| `appendHandoffDelta` | method | appendHandoffDelta(taskId: string, turnId: string, delta: string) |  |  |  |  |

| `claim` | method | claim(eventId: string) |  |  |  |  |

| `claimTerminalNotice` | method | claimTerminalNotice(taskId: string, status: string) |  |  |  |  |

| `entries` | method | entries(taskId: string) |  |  |  |  |

| `handle` | method | handle(event: StreamEvent) |  |  |  |  |

| `hasActiveHandoffs` | method | hasActiveHandoffs() |  |  |  |  |

| `isBackgroundToolScoped` | method | isBackgroundToolScoped(event: StreamEvent) |  |  |  |  |

| `isTaskScoped` | method | isTaskScoped(event: StreamEvent) |  |  |  |  |

| `record` | method | record(taskId: string, kind: TaskActivityKind, text: string, turnId?: string) |  |  |  |  |

| `recordSystemMessage` | method | recordSystemMessage(taskId: string, message: string, failed = false) |  |  |  |  |

| `recordUserMessage` | method | recordUserMessage(taskId: string, message: string) |  |  |  |  |

| `rememberScopedTool` | method | rememberScopedTool(event: StreamEvent) |  |  |  |  |

| `rememberScopedToolCall` | method | rememberScopedToolCall(toolCallId: string) |  |  |  |  |

| `rememberScopedTurn` | method | rememberScopedTurn(turnId: string) |  |  |  |  |

| `rememberToolParent` | method | rememberToolParent(toolCallId: string, parentToolCallId: string) |  |  |  |  |

| `retain` | method | retain(taskId: string, entries: TaskActivityEntry[]) |  |  |  |  |

| `scopedTool` | method | scopedTool(toolCallId: string) |  |  |  |  |

| `settleActiveHandoffs` | method | settleActiveHandoffs() |  |  |  |  |

| `TaskActivityKind` | type | type TaskActivityKind |  |  |  |  |

| `BackgroundTaskOutput` | interface | interface BackgroundTaskOutput |  |  |  |  |

| `BoundedToolText` | class | class BoundedToolText |  |  |  |  |

| `MAX_ACTIVE_TOOL_TEXT_CHARACTERS` | const | MAX_ACTIVE_TOOL_TEXT_CHARACTERS |  |  |  |  |

| `toolTextValue` | function | toolTextValue(value: string | BoundedToolText | undefined) |  |  |  |  |

| `append` | method | append(delta: string) |  |  |  |  |

| `appendTail` | method | appendTail(delta: string) |  |  |  |  |

| `beginTruncation` | method | beginTruncation(delta: string) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `isTruncated` | method | isTruncated() |  |  |  |  |

| `materializeTail` | method | materializeTail() |  |  |  |  |

| `omittedCharacters` | method | omittedCharacters() |  |  |  |  |

| `output` | method | output() |  |  |  |  |

| `replace` | method | replace(value: string) |  |  |  |  |

| `retainedCharacters` | method | retainedCharacters() |  |  |  |  |

| `toJSON` | method | toJSON() |  |  |  |  |

| `toString` | method | toString() |  |  |  |  |

| `totalCharacters` | method | totalCharacters() |  |  |  |  |

| `value` | method | value() |  |  |  |  |

| `ChoiceItem` | interface | interface ChoiceItem |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `scrollContent` | method | scrollContent(delta: number) |  |  |  |  |

| `setSelectionPreview` | method | setSelectionPreview(preview: Component | undefined) |  |  |  |  |

| `updateFilter` | method | updateFilter(filter: string) |  |  |  |  |

| `CodeHighlighter` | class | class CodeHighlighter |  |  |  |  |

| `ACTIVE_TYPESCRIPT_HIGHLIGHT_MAX_CHARACTERS` | const | ACTIVE_TYPESCRIPT_HIGHLIGHT_MAX_CHARACTERS |  |  |  |  |

| `CODE_HIGHLIGHT_CACHE_MAX_CHARACTERS` | const | CODE_HIGHLIGHT_CACHE_MAX_CHARACTERS |  |  |  |  |

| `CODE_HIGHLIGHT_CACHE_MAX_ENTRIES` | const | CODE_HIGHLIGHT_CACHE_MAX_ENTRIES |  |  |  |  |

| `isIncrementalTypescriptSource` | function | isIncrementalTypescriptSource(source: string) |  |  |  |  |

| `isLineLocalScript` | function | isLineLocalScript(source: string) |  |  |  |  |

| `isSingleFunctionScriptHeader` | function | isSingleFunctionScriptHeader(source: string) |  |  |  |  |

| `isSingleOpenScriptFunction` | function | isSingleOpenScriptFunction(source: string) |  |  |  |  |

| `languageForFilename` | function | languageForFilename(filePath: string) |  |  |  |  |

| `activeSize` | method | activeSize(source: string, lines: readonly string[]) |  |  |  |  |

| `cacheResult` | method | cacheResult(key: string, lines: string[]) |  |  |  |  |

| `highlight` | method | highlight(code: string, language?: string) |  |  |  |  |

| `highlightFileLine` | method | highlightFileLine(code: string, filePath: string) |  |  |  |  |

| `highlightSource` | method | highlightSource(source: string, language: string) |  |  |  |  |

| `highlightTypescriptStream` | method | highlightTypescriptStream(source: string) |  |  |  |  |

| `isEnabled` | method | isEnabled() |  |  |  |  |

| `promoteActiveTypescript` | method | promoteActiveTypescript() |  |  |  |  |

| `retainIncrementalTypescript` | method | retainIncrementalTypescript(active: IncrementalTypescriptHighlight) |  |  |  |  |

| `setColorScheme` | method | setColorScheme(colorScheme: ZCodeColorScheme) |  |  |  |  |

| `typescriptBlockCandidate` | method | typescriptBlockCandidate(source: string) |  |  |  |  |

| `typescriptLineCandidate` | method | typescriptLineCandidate(source: string) |  |  |  |  |

| `typescriptTopLevelCandidate` | method | typescriptTopLevelCandidate(source: string) |  |  |  |  |

| `colorSchemeFromColorFgBg` | function | colorSchemeFromColorFgBg(value = process.env.COLORFGBG) |  |  |  |  |

| `colorSchemeFromRgb` | function | colorSchemeFromRgb(color: RgbColor) |  |  |  |  |

| `themePreference` | function | themePreference(value: unknown) |  |  |  |  |

| `RgbColor` | interface | interface RgbColor |  |  |  |  |

| `ZCodeColorScheme` | type | type ZCodeColorScheme |  |  |  |  |

| `ZCodeThemePreference` | type | type ZCodeThemePreference |  |  |  |  |

| `estimateTranscriptContextBreakdown` | function | estimateTranscriptContextBreakdown(value: unknown) |  |  |  |  |

| `findActiveBranchMessageIds` | function | findActiveBranchMessageIds(value: unknown) |  |  |  |  |

| `ContextCacheSummary` | interface | interface ContextCacheSummary |  |  |  |  |

| `ContextCacheTrend` | interface | interface ContextCacheTrend |  |  |  |  |

| `ContextCacheTurn` | interface | interface ContextCacheTurn |  |  |  |  |

| `ContextCacheTurnState` | type | type ContextCacheTurnState |  |  |  |  |

| `ContextDetailView` | class | class ContextDetailView |  |  |  |  |

| `StatusDetailView` | class | class StatusDetailView |  |  |  |  |

| `ContextDetailRefreshData` | interface | interface ContextDetailRefreshData |  |  |  |  |

| `StatusDetailData` | interface | interface StatusDetailData |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderComposition` | method | renderComposition(width: number) |  |  |  |  |

| `renderOverview` | method | renderOverview(width: number) |  |  |  |  |

| `renderTrend` | method | renderTrend(width: number) |  |  |  |  |

| `setData` | method | setData(usage: RuntimeContextUsage | undefined, trend: ContextCacheTrend | undefined) |  |  |  |  |

| `DiffDetailPage` | class | class DiffDetailPage |  |  |  |  |

| `diffFileDescription` | function | diffFileDescription(file: FileDiffData) |  |  |  |  |

| `DiffBrowserSource` | interface | interface DiffBrowserSource |  |  |  |  |

| `allLines` | method | allLines(width: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `pageCount` | method | pageCount(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `historyText` | function | historyText(value: unknown) |  |  |  |  |

| `isModelCancellationEvent` | function | isModelCancellationEvent(event: StreamEvent) |  |  |  |  |

| `isToolCancellation` | function | isToolCancellation(value: unknown) |  |  |  |  |

| `modelLabel` | function | modelLabel(value: unknown) |  |  |  |  |

| `normalizeEvent` | function | normalizeEvent(value: unknown) |  |  |  |  |

| `normalizeRestoredPart` | function | normalizeRestoredPart(value: unknown) |  |  |  |  |

| `responseText` | function | responseText(value: unknown) |  |  |  |  |

| `restoredMessages` | function | restoredMessages(value: unknown) |  |  |  |  |

| `PartIdentity` | interface | interface PartIdentity |  |  |  |  |

| `RestoredMessage` | interface | interface RestoredMessage |  |  |  |  |

| `StreamEvent` | interface | interface StreamEvent |  |  |  |  |

| `RestoredPart` | type | type RestoredPart |  |  |  |  |

| `buildExitSummary` | function | buildExitSummary(options: ExitSummaryOptions) |  |  |  |  |

| `formatTokenUsage` | function | formatTokenUsage(metrics: SessionMetrics) |  |  |  |  |

| `resumeCommand` | function | resumeCommand(sessionId?: string) |  |  |  |  |

| `ExitSummary` | interface | interface ExitSummary |  |  |  |  |

| `ExitSummaryOptions` | interface | interface ExitSummaryOptions |  |  |  |  |

| `FILE_DIFF_RETENTION_LIMITS` | const | FILE_DIFF_RETENTION_LIMITS |  |  |  |  |

| `MAX_RETAINED_DIFF_CHARACTERS` | const | MAX_RETAINED_DIFF_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_DIFF_FILES` | const | MAX_RETAINED_DIFF_FILES |  |  |  |  |

| `MAX_RETAINED_DIFF_LINES` | const | MAX_RETAINED_DIFF_LINES |  |  |  |  |

| `fileDiffRetentionSize` | function | fileDiffRetentionSize(diffs: readonly FileDiffData[]) |  |  |  |  |

| `FileDiffRetentionLimits` | interface | interface FileDiffRetentionLimits |  |  |  |  |

| `FileDiffRetentionSize` | interface | interface FileDiffRetentionSize |  |  |  |  |

| `FileDiffView` | class | class FileDiffView |  |  |  |  |

| `fileDiffCard` | function | fileDiffCard(options: FileDiffViewOptions, width = 80) |  |  |  |  |

| `fileDiffsForPermission` | function | fileDiffsForPermission(name: string, input: unknown) |  |  |  |  |

| `isFileMutationTool` | function | isFileMutationTool(name: string) |  |  |  |  |

| `FileDiffData` | interface | interface FileDiffData |  |  |  |  |

| `FileDiffHunk` | interface | interface FileDiffHunk |  |  |  |  |

| `FileDiffViewOptions` | interface | interface FileDiffViewOptions |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderHeader` | method | renderHeader(diff: FileDiffData, index: number, width: number) |  |  |  |  |

| `renderHunkHeader` | method | renderHunkHeader(hunk: FileDiffHunk, digits: number, width: number) |  |  |  |  |

| `FooterBar` | class | class FooterBar |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setContent` | method | setContent(left: string, right?: string, compactRight?: string) |  |  |  |  |

| `FullscreenHeader` | class | class FullscreenHeader |  |  |  |  |

| `SessionWelcome` | class | class SessionWelcome |  |  |  |  |

| `displayWorkspacePath` | function | displayWorkspacePath(workspace: string, homeDirectory = homedir() |  |  |  |  |

| `FullscreenHeaderOptions` | interface | interface FullscreenHeaderOptions |  |  |  |  |

| `SessionWelcomeOptions` | interface | interface SessionWelcomeOptions |  |  |  |  |

| `getPhase` | method | getPhase() |  |  |  |  |

| `identity` | method | identity(width: number, includeVersion = true) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `location` | method | location(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setIncludeIdentity` | method | setIncludeIdentity(include: boolean) |  |  |  |  |

| `setLoginRequired` | method | setLoginRequired(required: boolean) |  |  |  |  |

| `setPhase` | method | setPhase(phase: FullscreenHeaderPhase) |  |  |  |  |

| `setTransitioning` | method | setTransitioning(transitioning: boolean) |  |  |  |  |

| `FullscreenHeaderPhase` | type | type FullscreenHeaderPhase |  |  |  |  |

| `formatTokens` | function | formatTokens(value: number) |  |  |  |  |

| `goalStatusLabel` | function | goalStatusLabel(goal: GoalState | undefined) |  |  |  |  |

| `goalStatusText` | function | goalStatusText(goal: GoalState | undefined) |  |  |  |  |

| `normalizeGoal` | function | normalizeGoal(value: unknown) |  |  |  |  |

| `GoalState` | interface | interface GoalState |  |  |  |  |

| `GoalStatus` | type | type GoalStatus |  |  |  |  |

| `loginFailureDiagnostic` | function | loginFailureDiagnostic(stdout: string, stderr: string) |  |  |  |  |

| `runTui` | function | runTui(options: TuiOptions) |  |  |  |  |

| `shouldSuspendForLoginCommand` | function | shouldSuspendForLoginCommand(command: string) |  |  |  |  |

| `suppressTuiAiSdkWarnings` | function | suppressTuiAiSdkWarnings() |  |  |  |  |

| `addAssistantMessage` | method | addAssistantMessage(text: string, partId?: string, messageId?: string) |  |  |  |  |

| `addSystemEvent` | method | addSystemEvent(event: SystemEventData, blockId?: string) |  |  |  |  |

| `addUpdateAvailable` | method | addUpdateAvailable(currentVersion: string, latestVersion: string) |  |  |  |  |

| `addUserMessage` | method | addUserMessage(text: string, attachmentCount = 0, messageId?: string) |  |  |  |  |

| `appendThinking` | method | appendThinking(delta: string, partId?: string, messageId?: string) |  |  |  |  |

| `applyBackgroundTaskEvent` | method | applyBackgroundTaskEvent(event: StreamEvent) |  |  |  |  |

| `applyConversationRewind` | method | applyConversationRewind(target: RewindTarget, scope: RewindScope) |  |  |  |  |

| `applyExecutionState` | method | applyExecutionState(value: unknown) |  |  |  |  |

| `applyModeShortcut` | method | applyModeShortcut(requestedMode: Mode, announce = false) |  |  |  |  |

| `applyRuntimeProjection` | method | applyRuntimeProjection(projection: RuntimeProjectionSnapshot | undefined) |  |  |  |  |

| `applySessionUsage` | method | applySessionUsage(usage: unknown) |  |  |  |  |

| `applySettingCommand` | method | applySettingCommand(command: string, target: SettingTarget) |  |  |  |  |

| `attachClipboardImage` | method | attachClipboardImage() |  |  |  |  |

| `attachPendingToolRelationships` | method | attachPendingToolRelationships(tool: ToolViewState) |  |  |  |  |

| `attachToolAtRoot` | method | attachToolAtRoot(tool: ToolViewState) |  |  |  |  |

| `autocompleteCommands` | method | autocompleteCommands() |  |  |  |  |

| `backgroundTaskDetail` | method | backgroundTaskDetail(job: RuntimeBackgroundJob) |  |  |  |  |

| `beginTurn` | method | beginTurn(prompt?: string) |  |  |  |  |

| `bindInput` | method | bindInput() |  |  |  |  |

| `buildLayout` | method | buildLayout() |  |  |  |  |

| `canEnterAttachmentSelection` | method | canEnterAttachmentSelection() |  |  |  |  |

| `cancelActiveBackgroundAgentTasks` | method | cancelActiveBackgroundAgentTasks() |  |  |  |  |

| `clearPendingAttachments` | method | clearPendingAttachments(notify: boolean) |  |  |  |  |

| `clearRewindEscape` | method | clearRewindEscape() |  |  |  |  |

| `clearTranscriptProjection` | method | clearTranscriptProjection() |  |  |  |  |

| `completeThinking` | method | completeThinking(partId?: string) |  |  |  |  |

| `consumeRecentSteerCommitGuard` | method | consumeRecentSteerCommitGuard() |  |  |  |  |

| `copySelectionOrLastResponse` | method | copySelectionOrLastResponse() |  |  |  |  |

| `createEditor` | method | createEditor(tui: TUI) |  |  |  |  |

| `createTui` | method | createTui(mode: TuiMode) |  |  |  |  |

| `debugEvent` | method | debugEvent(channel: string, value: unknown) |  |  |  |  |

| `detachToolFromLocation` | method | detachToolFromLocation(tool: ToolViewState) |  |  |  |  |

| `drainInputAfterBackgroundHandoff` | method | drainInputAfterBackgroundHandoff() |  |  |  |  |

| `editLatestQueuedFollowUp` | method | editLatestQueuedFollowUp() |  |  |  |  |

| `enterAttachmentSelection` | method | enterAttachmentSelection() |  |  |  |  |

| `enterSessionRail` | method | enterSessionRail(immediate = false) |  |  |  |  |

| `finalizeUnresolvedTools` | method | finalizeUnresolvedTools(state: string, error?: unknown) |  |  |  |  |

| `finishStop` | method | finishStop(elapsedMilliseconds: number) |  |  |  |  |

| `finishTurn` | method | finishTurn(unfinishedToolState = "interrupted") |  |  |  |  |

| `focusEditor` | method | focusEditor() |  |  |  |  |

| `forceFullRedraw` | method | forceFullRedraw() |  |  |  |  |

| `fullscreenAltScreen` | method | fullscreenAltScreen() |  |  |  |  |

| `handleProtocolPartEvent` | method | handleProtocolPartEvent(event: StreamEvent) |  |  |  |  |

| `handleRewindEscape` | method | handleRewindEscape() |  |  |  |  |

| `handleSendOutcome` | method | handleSendOutcome(outcome: unknown) |  |  |  |  |

| `handleSessionRename` | method | handleSessionRename(title: string) |  |  |  |  |

| `handleSignal` | method | handleSignal(signal: NodeJS.Signals) |  |  |  |  |

| `handleSubagentLifecycle` | method | handleSubagentLifecycle(event: StreamEvent) |  |  |  |  |

| `handleTranscriptNavigation` | method | handleTranscriptNavigation(argument: string) |  |  |  |  |

| `handleTranscriptSearch` | method | handleTranscriptSearch(argument: string) |  |  |  |  |

| `installStreamErrorGuards` | method | installStreamErrorGuards() |  |  |  |  |

| `interruptBackgroundHandoffForInput` | method | interruptBackgroundHandoffForInput() |  |  |  |  |

| `isBackgroundCoordinatorReasoning` | method | isBackgroundCoordinatorReasoning(event: StreamEvent) |  |  |  |  |

| `isForeignSessionEvent` | method | isForeignSessionEvent(event: StreamEvent) |  |  |  |  |

| `isOverlayFocused` | method | isOverlayFocused() |  |  |  |  |

| `leaveAttachmentSelection` | method | leaveAttachmentSelection() |  |  |  |  |

| `loadHistory` | method | loadHistory() |  |  |  |  |

| `manageWorkflow` | method | manageWorkflow(runId: string) |  |  |  |  |

| `markPendingTurnNotificationFailed` | method | markPendingTurnNotificationFailed(detail?: string) |  |  |  |  |

| `mountLayout` | method | mountLayout() |  |  |  |  |

| `mountRegularSessionWelcome` | method | mountRegularSessionWelcome() |  |  |  |  |

| `noticeRestoredBackgroundTasks` | method | noticeRestoredBackgroundTasks(projection: RuntimeProjectionSnapshot) |  |  |  |  |

| `onEvent` | method | onEvent(value: unknown, turnEpoch?: number) |  |  |  |  |

| `onSessionEvent` | method | onSessionEvent(value: unknown) |  |  |  |  |

| `permissionPreview` | method | permissionPreview(toolName: string, input: unknown, riskLevel?: string) |  |  |  |  |

| `prepareTranscriptViewport` | method | prepareTranscriptViewport() |  |  |  |  |

| `promoteToolChildren` | method | promoteToolChildren(tool: ToolViewState) |  |  |  |  |

| `questionChoiceHelp` | method | questionChoiceHelp(canGoBack: boolean) |  |  |  |  |

| `queueCurrentEditorInput` | method | queueCurrentEditorInput() |  |  |  |  |

| `readContextDetailData` | method | readContextDetailData() |  |  |  |  |

| `readMcpSummary` | method | readMcpSummary() |  |  |  |  |

| `reconcileTurnTiming` | method | reconcileTurnTiming(projection: RuntimeProjectionSnapshot) |  |  |  |  |

| `recordAssistantText` | method | recordAssistantText(text: string) |  |  |  |  |

| `recoverSessionModel` | method | recoverSessionModel() |  |  |  |  |

| `refreshExecutionState` | method | refreshExecutionState() |  |  |  |  |

| `refreshExitUsage` | method | refreshExitUsage() |  |  |  |  |

| `refreshGoal` | method | refreshGoal() |  |  |  |  |

| `refreshModelOptions` | method | refreshModelOptions() |  |  |  |  |

| `refreshRuntimeState` | method | refreshRuntimeState() |  |  |  |  |

| `refreshSessionTerminalTitle` | method | refreshSessionTerminalTitle() |  |  |  |  |

| `refreshSessionUsage` | method | refreshSessionUsage() |  |  |  |  |

| `refreshWorkflowFromEvent` | method | refreshWorkflowFromEvent() |  |  |  |  |

| `rememberEditorHistory` | method | rememberEditorHistory(input: string) |  |  |  |  |

| `removePendingAttachment` | method | removePendingAttachment(index: number) |  |  |  |  |

| `removeProtocolMessage` | method | removeProtocolMessage(messageId: string) |  |  |  |  |

| `removeProtocolPart` | method | removeProtocolPart(partId: string) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderWorkflowPanel` | method | renderWorkflowPanel(value: Record<string, unknown>) |  |  |  |  |

| `requestForegroundTurnInterrupt` | method | requestForegroundTurnInterrupt() |  |  |  |  |

| `requestPendingSteerInterrupt` | method | requestPendingSteerInterrupt() |  |  |  |  |

| `requestPermission` | method | requestPermission(requestValue: unknown, context?: unknown) |  |  |  |  |

| `requestPermissionUnqueued` | method | requestPermissionUnqueued(requestValue: unknown, signal?: AbortSignal) |  |  |  |  |

| `requestPlanApproval` | method | requestPlanApproval(input: unknown, signal?: AbortSignal) |  |  |  |  |

| `requestStreamRender` | method | requestStreamRender() |  |  |  |  |

| `requestUserQuestions` | method | requestUserQuestions(input: unknown, signal?: AbortSignal) |  |  |  |  |

| `rescheduleRuntimePoll` | method | rescheduleRuntimePoll() |  |  |  |  |

| `resetSessionPresentation` | method | resetSessionPresentation() |  |  |  |  |

| `resolveTerminalColorScheme` | method | resolveTerminalColorScheme() |  |  |  |  |

| `restoreCustomSessionTitle` | method | restoreCustomSessionTitle() |  |  |  |  |

| `restoreInitialTranscript` | method | restoreInitialTranscript() |  |  |  |  |

| `restorePart` | method | restorePart(part: RestoredPart, role: "assistant" | "system", fallbackMessageId?: string) |  |  |  |  |

| `restoreSessionModel` | method | restoreSessionModel() |  |  |  |  |

| `restoreTranscript` | method | restoreTranscript(messages: RestoredMessage[]) |  |  |  |  |

| `rewindFilePreviewText` | method | rewindFilePreviewText(preview: FileRewindPreview | undefined, error?: string) |  |  |  |  |

| `run` | method | run() |  |  |  |  |

| `runFirstRunSetup` | method | runFirstRunSetup(manual = false) |  |  |  |  |

| `runSuspendedLogin` | method | runSuspendedLogin(displayInput: string, overrideCommand?: string) |  |  |  |  |

| `scheduleRuntimeRefresh` | method | scheduleRuntimeRefresh(delay = 80) |  |  |  |  |

| `sendTaskCommand` | method | sendTaskCommand(command: string, resume: boolean) |  |  |  |  |

| `setCopyOnSelect` | method | setCopyOnSelect(enabled: boolean) |  |  |  |  |

| `setCurrentInput` | method | setCurrentInput(data: string | undefined) |  |  |  |  |

| `setLoginRequired` | method | setLoginRequired(required: boolean) |  |  |  |  |

| `setToolParent` | method | setToolParent(tool: ToolViewState, parentToolCallId: string) |  |  |  |  |

| `settleThinking` | method | settleThinking(partId?: string) |  |  |  |  |

| `settleTurnTiming` | method | settleTurnTiming() |  |  |  |  |

| `shortcutAvailable` | method | shortcutAvailable() |  |  |  |  |

| `showActivityDetails` | method | showActivityDetails() |  |  |  |  |

| `showBackgroundTaskDetail` | method | showBackgroundTaskDetail(taskId: string) |  |  |  |  |

| `showBackgroundTasks` | method | showBackgroundTasks() |  |  |  |  |

| `showChoice` | method | showChoice(options: Parameters<typeof choose>[3]) |  |  |  |  |

| `showConfiguration` | method | showConfiguration() |  |  |  |  |

| `showContextDetails` | method | showContextDetails() |  |  |  |  |

| `showConversationRewind` | method | showConversationRewind() |  |  |  |  |

| `showDiffBrowser` | method | showDiffBrowser() |  |  |  |  |

| `showMcpPicker` | method | showMcpPicker() |  |  |  |  |

| `showModePicker` | method | showModePicker() |  |  |  |  |

| `showModelPicker` | method | showModelPicker() |  |  |  |  |

| `showModelProviderSettings` | method | showModelProviderSettings() |  |  |  |  |

| `showSelection` | method | showSelection(selection: Record<string, unknown>) |  |  |  |  |

| `showStatusDetails` | method | showStatusDetails() |  |  |  |  |

| `showTextPrompt` | method | showTextPrompt(options: Parameters<typeof promptText>[3]) |  |  |  |  |

| `showWorkflowPanel` | method | showWorkflowPanel(value: Record<string, unknown>) |  |  |  |  |

| `startUpdateRefresh` | method | startUpdateRefresh(updateCheck: StartupUpdateCheck | undefined) |  |  |  |  |

| `stop` | method | stop() |  |  |  |  |

| `stopBackgroundTask` | method | stopBackgroundTask(taskId: string) |  |  |  |  |

| `stopSessionTitleSpinner` | method | stopSessionTitleSpinner() |  |  |  |  |

| `submit` | method | submit(rawInput: string, queuedSubmission?: QueuedSubmission) |  |  |  |  |

| `suppressBackgroundCoordinatorMessage` | method | suppressBackgroundCoordinatorMessage(messageId: string | undefined) |  |  |  |  |

| `suppressBackgroundToolTranscript` | method | suppressBackgroundToolTranscript(event: StreamEvent) |  |  |  |  |

| `switchEffort` | method | switchEffort() |  |  |  |  |

| `switchMode` | method | switchMode() |  |  |  |  |

| `switchModel` | method | switchModel() |  |  |  |  |

| `switchPlan` | method | switchPlan(enabled?: boolean) |  |  |  |  |

| `switchTransientModel` | method | switchTransientModel(modelId: string) |  |  |  |  |

| `switchTuiMode` | method | switchTuiMode(next: TuiMode) |  |  |  |  |

| `syncAttachmentBar` | method | syncAttachmentBar() |  |  |  |  |

| `toolRelationshipWouldCycle` | method | toolRelationshipWouldCycle(childId: string, parent: ToolViewState) |  |  |  |  |

| `updateActivity` | method | updateActivity(activity: string | undefined, requestRender = true) |  |  |  |  |

| `updateLoginWarning` | method | updateLoginWarning() |  |  |  |  |

| `updateMetadata` | method | updateMetadata() |  |  |  |  |

| `updateRuntimeActivity` | method | updateRuntimeActivity(requestRender = true) |  |  |  |  |

| `updateTurnStatus` | method | updateTurnStatus(requestRender = true) |  |  |  |  |

| `upsertProtocolPart` | method | upsertProtocolPart(part: RestoredPart) |  |  |  |  |

| `InputQueue` | class | class InputQueue |  |  |  |  |

| `CommittedSteer` | interface | interface CommittedSteer |  |  |  |  |

| `InputQueueCallbacks` | interface | interface InputQueueCallbacks |  |  |  |  |

| `InputQueueState` | interface | interface InputQueueState |  |  |  |  |

| `PendingSteerSubmission` | interface | interface PendingSteerSubmission |  |  |  |  |

| `QueuedSubmission` | interface | interface QueuedSubmission |  |  |  |  |

| `admittedPendingInputIds` | method | admittedPendingInputIds() |  |  |  |  |

| `associateSteer` | method | associateSteer(inputId: string, pendingInputId: string, targetTurnId?: string) |  |  |  |  |

| `autoSend` | method | autoSend() |  |  |  |  |

| `editLatestFollowUp` | method | editLatestFollowUp() |  |  |  |  |

| `findSteer` | method | findSteer(inputId: string | undefined) |  |  |  |  |

| `handleLifecycleEvent` | method | handleLifecycleEvent(event: StreamEvent) |  |  |  |  |

| `hasFollowUps` | method | hasFollowUps() |  |  |  |  |

| `hasPendingSteers` | method | hasPendingSteers() |  |  |  |  |

| `matchesTurn` | method | matchesTurn(left?: string, right?: string) |  |  |  |  |

| `queueFollowUp` | method | queueFollowUp(submission: QueuedSubmission) |  |  |  |  |

| `rememberCompletedTurn` | method | rememberCompletedTurn(turnId: string) |  |  |  |  |

| `rememberResolution` | method | rememberResolution(pendingInputId: string, resolution: PendingSteerResolution) |  |  |  |  |

| `removeSteer` | method | removeSteer(inputId: string | undefined) |  |  |  |  |

| `resetAutoSend` | method | resetAutoSend() |  |  |  |  |

| `restoreFollowUp` | method | restoreFollowUp(submission: QueuedSubmission) |  |  |  |  |

| `settleSteer` | method | settleSteer(pending: PendingSteerSubmission, resolution: PendingSteerResolution) |  |  |  |  |

| `syncView` | method | syncView() |  |  |  |  |

| `takeNextFollowUp` | method | takeNextFollowUp() |  |  |  |  |

| `answeredQuestionInput` | function | answeredQuestionInput(input: unknown, answers: Record<string, string>) |  |  |  |  |

| `defaultPermissionChoices` | function | defaultPermissionChoices(toolName: string, input: unknown) |  |  |  |  |

| `isAskUserQuestionTool` | function | isAskUserQuestionTool(name: string) |  |  |  |  |

| `isExitPlanModeTool` | function | isExitPlanModeTool(name: string) |  |  |  |  |

| `parseUserQuestions` | function | parseUserQuestions(input: unknown) |  |  |  |  |

| `planText` | function | planText(input: unknown) |  |  |  |  |

| `PermissionChoice` | interface | interface PermissionChoice |  |  |  |  |

| `UserQuestion` | interface | interface UserQuestion |  |  |  |  |

| `UserQuestionOption` | interface | interface UserQuestionOption |  |  |  |  |

| `UserQuestionAnswerResult` | type | type UserQuestionAnswerResult |  |  |  |  |

| `UserQuestionAnswerer` | type | type UserQuestionAnswerer |  |  |  |  |

| `TurnNotifier` | class | class TurnNotifier |  |  |  |  |

| `detectedTerminal` | function | detectedTerminal(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `notificationPreview` | function | notificationPreview(value: string, maximum = notificationPreviewGraphemes) |  |  |  |  |

| `osc9NotificationSequence` | function | osc9NotificationSequence(message: string, tmux = false) |  |  |  |  |

| `supportsOsc9` | function | supportsOsc9(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `NativeNotificationCommand` | interface | interface NativeNotificationCommand |  |  |  |  |

| `NotificationDiagnostics` | interface | interface NotificationDiagnostics |  |  |  |  |

| `NotificationSettings` | interface | interface NotificationSettings |  |  |  |  |

| `currentSettings` | method | currentSettings() |  |  |  |  |

| `diagnostics` | method | diagnostics() |  |  |  |  |

| `disableFocusReporting` | method | disableFocusReporting() |  |  |  |  |

| `handleInput` | method | handleInput(data: string) |  |  |  |  |

| `markTerminalUnavailable` | method | markTerminalUnavailable() |  |  |  |  |

| `notify` | method | notify(kind: TurnNotificationKind, detail = "") |  |  |  |  |

| `setFocusReportingRequired` | method | setFocusReportingRequired(required: boolean) |  |  |  |  |

| `setSettings` | method | setSettings(settings: NotificationSettings) |  |  |  |  |

| `start` | method | start() |  |  |  |  |

| `stop` | method | stop() |  |  |  |  |

| `syncFocusReporting` | method | syncFocusReporting() |  |  |  |  |

| `writeNative` | method | writeNative(title: string, body: string) |  |  |  |  |

| `writeOsc9` | method | writeOsc9(body: string) |  |  |  |  |

| `writeTerminal` | method | writeTerminal(data: string) |  |  |  |  |

| `NativeNotificationSender` | type | type NativeNotificationSender |  |  |  |  |

| `NotificationBackend` | type | type NotificationBackend |  |  |  |  |

| `NotificationCondition` | type | type NotificationCondition |  |  |  |  |

| `NotificationMethod` | type | type NotificationMethod |  |  |  |  |

| `TerminalFocusState` | type | type TerminalFocusState |  |  |  |  |

| `TurnNotificationKind` | type | type TurnNotificationKind |  |  |  |  |

| `formatWorkflowPanel` | function | formatWorkflowPanel(value: unknown) |  |  |  |  |

| `isMcpPickerRequest` | function | isMcpPickerRequest(input: string) |  |  |  |  |

| `isTerminalWorkflowStatus` | function | isTerminalWorkflowStatus(status?: string) |  |  |  |  |

| `mcpPicker` | function | mcpPicker(value: unknown) |  |  |  |  |

| `workflowRunPicker` | function | workflowRunPicker(value: unknown) |  |  |  |  |

| `workflowSelectedRunId` | function | workflowSelectedRunId(value: unknown) |  |  |  |  |

| `workflowStatus` | function | workflowStatus(value: unknown, runId: string) |  |  |  |  |

| `PermissionRequestQueue` | class | class PermissionRequestQueue |  |  |  |  |

| `PermissionPreview` | class | class PermissionPreview |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `PlanEditor` | class | class PlanEditor |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `PlanUpdateView` | class | class PlanUpdateView |  |  |  |  |

| `isPlanUpdateTool` | function | isPlanUpdateTool(name: string) |  |  |  |  |

| `planCard` | function | planCard(options: PlanUpdateOptions) |  |  |  |  |

| `planHasHiddenItems` | function | planHasHiddenItems(input: unknown, result: unknown) |  |  |  |  |

| `PlanUpdateOptions` | interface | interface PlanUpdateOptions |  |  |  |  |

| `PluginReferenceCatalog` | class | class PluginReferenceCatalog |  |  |  |  |

| `isPluginReferenceValue` | function | isPluginReferenceValue(value: string) |  |  |  |  |

| `normalizePluginReferenceEntries` | function | normalizePluginReferenceEntries(result: unknown) |  |  |  |  |

| `pluginReferenceMarkdown` | function | pluginReferenceMarkdown(plugin: PluginReferenceEntry) |  |  |  |  |

| `PluginReferenceEntry` | interface | interface PluginReferenceEntry |  |  |  |  |

| `list` | method | list() |  |  |  |  |

| `ProtocolPartView` | class | class ProtocolPartView |  |  |  |  |

| `isVisibleProtocolPart` | function | isVisibleProtocolPart(part: RestoredPart) |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `lines` | method | lines() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `update` | method | update(part: RestoredPart) |  |  |  |  |

| `QueuedInputView` | class | class QueuedInputView |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setState` | method | setState(state: QueuedInputViewState) |  |  |  |  |

| `QueuedInputViewState` | type | type QueuedInputViewState |  |  |  |  |

| `isExpandableComponent` | function | isExpandableComponent(component: Component) |  |  |  |  |

| `isSearchableComponent` | function | isSearchableComponent(component: Component) |  |  |  |  |

| `isWindowedComponent` | function | isWindowedComponent(component: Component) |  |  |  |  |

| `ExpandableComponent` | interface | interface ExpandableComponent |  |  |  |  |

| `SearchableComponent` | interface | interface SearchableComponent |  |  |  |  |

| `WindowedComponent` | interface | interface WindowedComponent |  |  |  |  |

| `WindowedRenderResult` | interface | interface WindowedRenderResult |  |  |  |  |

| `fileRewindPreview` | function | fileRewindPreview(value: unknown) |  |  |  |  |

| `rewindCommand` | function | rewindCommand(scope: "conversation", messageId: string) |  |  |  |  |

| `rewindTargetLabel` | function | rewindTargetLabel(text: string, maximum = 100) |  |  |  |  |

| `rewindTargets` | function | rewindTargets(value: unknown) |  |  |  |  |

| `FileRewindEntry` | interface | interface FileRewindEntry |  |  |  |  |

| `FileRewindPreview` | interface | interface FileRewindPreview |  |  |  |  |

| `RewindTarget` | interface | interface RewindTarget |  |  |  |  |

| `RewindScope` | type | type RewindScope |  |  |  |  |

| `RichMarkdown` | class | class RichMarkdown |  |  |  |  |

| `isPlainMarkdownBlock` | function | isPlainMarkdownBlock(text: string) |  |  |  |  |

| `normalizeMermaidTerminalWidth` | function | normalizeMermaidTerminalWidth(source: string) |  |  |  |  |

| `renderMermaidPreview` | function | renderMermaidPreview(source: string, width: number) |  |  |  |  |

| `splitMarkdownSegments` | function | splitMarkdownSegments(text: string) |  |  |  |  |

| `splitStreamingMarkdownSegments` | function | splitStreamingMarkdownSegments(text: string) |  |  |  |  |

| `appendText` | method | appendText(delta: string) |  |  |  |  |

| `appendWrappedLines` | method | appendWrappedLines(contentWidth: number) |  |  |  |  |

| `finishText` | method | finishText() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `highlightedCodeLines` | method | highlightedCodeLines() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `invalidateTextLayout` | method | invalidateTextLayout() |  |  |  |  |

| `measureWindowLayout` | method | measureWindowLayout(width: number) |  |  |  |  |

| `presentLines` | method | presentLines(lines: string[], width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderFlatOptimized` | method | renderFlatOptimized(width: number) |  |  |  |  |

| `renderNestedOptimized` | method | renderNestedOptimized(width: number) |  |  |  |  |

| `renderOptimized` | method | renderOptimized(width: number) |  |  |  |  |

| `renderWindow` | method | renderWindow(width: number, start: number, count: number) |  |  |  |  |

| `resetWrapping` | method | resetWrapping() |  |  |  |  |

| `separatorRow` | method | separatorRow(width: number) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |

| `syncRenderedSegments` | method | syncRenderedSegments() |  |  |  |  |

| `tryAppend` | method | tryAppend(text: string) |  |  |  |  |

| `windowComponents` | method | windowComponents(rendered: RenderedMarkdownSegment) |  |  |  |  |

| `MarkdownSegment` | type | type MarkdownSegment |  |  |  |  |

| `RuntimeActivityView` | class | class RuntimeActivityView |  |  |  |  |

| `RuntimeActivityState` | interface | interface RuntimeActivityState |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `update` | method | update(state: RuntimeActivityState) |  |  |  |  |

| `ACTIVE_RUNTIME_POLL_INTERVAL_MS` | const | ACTIVE_RUNTIME_POLL_INTERVAL_MS |  |  |  |  |

| `IDLE_RUNTIME_POLL_INTERVAL_MS` | const | IDLE_RUNTIME_POLL_INTERVAL_MS |  |  |  |  |

| `runtimeActivityActive` | function | runtimeActivityActive(projection: RuntimeProjectionSnapshot | undefined) |  |  |  |  |

| `runtimePollInterval` | function | runtimePollInterval(active: boolean) |  |  |  |  |

| `runtimePollStateChanged` | function | runtimePollStateChanged(current: RuntimePollState, next: RuntimePollState) |  |  |  |  |

| `RuntimePollState` | interface | interface RuntimePollState |  |  |  |  |

| `isActiveBackgroundJob` | function | isActiveBackgroundJob(job: RuntimeBackgroundJob) |  |  |  |  |

| `isActiveRuntimeTool` | function | isActiveRuntimeTool(tool: RuntimeActiveToolCall) |  |  |  |  |

| `normalizeRuntimeProjection` | function | normalizeRuntimeProjection(value: unknown) |  |  |  |  |

| `normalizeTodoGroups` | function | normalizeTodoGroups(value: unknown) |  |  |  |  |

| `normalizeTodos` | function | normalizeTodos(value: unknown) |  |  |  |  |

| `RuntimeActiveToolCall` | interface | interface RuntimeActiveToolCall |  |  |  |  |

| `RuntimeBackgroundJob` | interface | interface RuntimeBackgroundJob |  |  |  |  |

| `RuntimeContextBreakdownItem` | interface | interface RuntimeContextBreakdownItem |  |  |  |  |

| `RuntimeContextUsage` | interface | interface RuntimeContextUsage |  |  |  |  |

| `RuntimeProjectionSnapshot` | interface | interface RuntimeProjectionSnapshot |  |  |  |  |

| `RuntimeTodo` | interface | interface RuntimeTodo |  |  |  |  |

| `RuntimeTodoGroup` | interface | interface RuntimeTodoGroup |  |  |  |  |

| `RuntimeBackgroundStatus` | type | type RuntimeBackgroundStatus |  |  |  |  |

| `RuntimeTaskKind` | type | type RuntimeTaskKind |  |  |  |  |

| `RuntimeToolStatus` | type | type RuntimeToolStatus |  |  |  |  |

| `parseSelectionCommand` | function | parseSelectionCommand(value: unknown, index: number) |  |  |  |  |

| `protectSubmission` | function | protectSubmission(input: string) |  |  |  |  |

| `redactSecrets` | function | redactSecrets(message: string, secrets: string[]) |  |  |  |  |

| `ProtectedSubmission` | interface | interface ProtectedSubmission |  |  |  |  |

| `SelectionCommand` | interface | interface SelectionCommand |  |  |  |  |

| `SelectionInteraction` | interface | interface SelectionInteraction |  |  |  |  |

| `effortPicker` | function | effortPicker(options: unknown[], currentEffort?: string) |  |  |  |  |

| `explicitModelRequest` | function | explicitModelRequest(input: string) |  |  |  |  |

| `isEffortPickerRequest` | function | isEffortPickerRequest(input: string) |  |  |  |  |

| `isModePickerRequest` | function | isModePickerRequest(input: string) |  |  |  |  |

| `isModelPickerRequest` | function | isModelPickerRequest(input: string) |  |  |  |  |

| `modePicker` | function | modePicker(currentMode?: string, availableModes?: readonly string[]) |  |  |  |  |

| `modelPicker` | function | modelPicker(options: unknown[], currentModel?: string) |  |  |  |  |

| `sessionRenameRequest` | function | sessionRenameRequest(input: string) |  |  |  |  |

| `PickerItem` | interface | interface PickerItem |  |  |  |  |

| `PickerSpec` | interface | interface PickerSpec |  |  |  |  |

| `contextRemainingPercent` | function | contextRemainingPercent(metrics: SessionMetrics) |  |  |  |  |

| `contextUsedPercent` | function | contextUsedPercent(metrics: SessionMetrics) |  |  |  |  |

| `mergeMetrics` | function | mergeMetrics(current: SessionMetrics, update: SessionMetrics | undefined) |  |  |  |  |

| `projectionMetrics` | function | projectionMetrics(value: unknown) |  |  |  |  |

| `sessionIdFromUsage` | function | sessionIdFromUsage(value: unknown) |  |  |  |  |

| `usageMetrics` | function | usageMetrics(value: unknown) |  |  |  |  |

| `SessionMetrics` | interface | interface SessionMetrics |  |  |  |  |

| `MAX_SESSION_TITLE_CHARS` | const | MAX_SESSION_TITLE_CHARS |  |  |  |  |

| `SESSION_TITLE_PREFIX` | const | SESSION_TITLE_PREFIX |  |  |  |  |

| `SESSION_TITLE_SPINNER_FRAME_DURATION_MS` | const | SESSION_TITLE_SPINNER_FRAME_DURATION_MS |  |  |  |  |

| `normalizeSessionTitle` | function | normalizeSessionTitle(title: string) |  |  |  |  |

| `sessionTitleFromFirstMessage` | function | sessionTitleFromFirstMessage(message: string) |  |  |  |  |

| `sessionTitleSpinnerFrame` | function | sessionTitleSpinnerFrame(elapsedMilliseconds: number, animated = true) |  |  |  |  |

| `modes` | const | modes |  |  |  |  |

| `appliesToSetting` | function | appliesToSetting(target: SettingTarget | undefined, field: SettingTarget) |  |  |  |  |

| `nextMode` | function | nextMode(currentMode?: string) |  |  |  |  |

| `nextPickerCommand` | function | nextPickerCommand(picker: PickerSpec, currentValue?: string) |  |  |  |  |

| `nextPickerValue` | function | nextPickerValue(picker: PickerSpec, currentValue?: string) |  |  |  |  |

| `normalizedMode` | function | normalizedMode(mode?: string, fallback: Mode = "build") |  |  |  |  |

| `settingTargetForCommand` | function | settingTargetForCommand(input: string) |  |  |  |  |

| `transcriptPageDirection` | function | transcriptPageDirection(data: string) |  |  |  |  |

| `Mode` | type | type Mode |  |  |  |  |

| `SettingTarget` | type | type SettingTarget |  |  |  |  |

| `SkillCatalog` | class | class SkillCatalog |  |  |  |  |

| `normalizeSkillEntries` | function | normalizeSkillEntries(result: unknown) |  |  |  |  |

| `resolveSkillMentions` | function | resolveSkillMentions(input: string, skills: SkillEntry[]) |  |  |  |  |

| `PreparedSkillPrompt` | interface | interface PreparedSkillPrompt |  |  |  |  |

| `SkillEntry` | interface | interface SkillEntry |  |  |  |  |

| `list` | method | list() |  |  |  |  |

| `preparePrompt` | method | preparePrompt(input: string) |  |  |  |  |

| `StatusLine` | class | class StatusLine |  |  |  |  |

| `StatusLineField` | interface | interface StatusLineField |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setFields` | method | setFields(fields: StatusLineField[], separator = " · ") |  |  |  |  |

| `width` | method | width(fields: RenderedField[]) |  |  |  |  |

| `StreamErrorSource` | interface | interface StreamErrorSource |  |  |  |  |

| `SystemEventView` | class | class SystemEventView |  |  |  |  |

| `SystemEventData` | interface | interface SystemEventData |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `StreamingTerminalTextSanitizer` | class | class StreamingTerminalTextSanitizer |  |  |  |  |

| `removeLastGrapheme` | function | removeLastGrapheme(value: string) |  |  |  |  |

| `wrapTerminalText` | function | wrapTerminalText(value: string, width: number) |  |  |  |  |

| `SanitizeTerminalTextOptions` | interface | interface SanitizeTerminalTextOptions |  |  |  |  |

| `append` | method | append(value: string) |  |  |  |  |

| `finish` | method | finish() |  |  |  |  |

| `reset` | method | reset() |  |  |  |  |

| `createTheme` | function | createTheme(enabled: boolean, initialColorScheme: ZCodeColorScheme = "dark") |  |  |  |  |

| `ZCodeTheme` | interface | interface ZCodeTheme |  |  |  |  |

| `ThinkingView` | class | class ThinkingView |  |  |  |  |

| `append` | method | append(delta: string) |  |  |  |  |

| `complete` | method | complete() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `replace` | method | replace(text: string) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |

| `trim` | method | trim() |  |  |  |  |

| `value` | method | value() |  |  |  |  |

| `ToolGroupView` | class | class ToolGroupView |  |  |  |  |

| `addTool` | method | addTool(tool: ToolExecutionView) |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `removeTool` | method | removeTool(tool: ToolExecutionView) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `size` | method | size() |  |  |  |  |

| `MAX_RETAINED_TOOL_IMAGE_CHARACTERS` | const | MAX_RETAINED_TOOL_IMAGE_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_CHARACTERS` | const | MAX_RETAINED_TOOL_PAYLOAD_CHARACTERS |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_DEPTH` | const | MAX_RETAINED_TOOL_PAYLOAD_DEPTH |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_ENTRIES` | const | MAX_RETAINED_TOOL_PAYLOAD_ENTRIES |  |  |  |  |

| `MAX_RETAINED_TOOL_PAYLOAD_NODES` | const | MAX_RETAINED_TOOL_PAYLOAD_NODES |  |  |  |  |

| `OMITTED_BINARY_PAYLOAD_PREFIX` | const | OMITTED_BINARY_PAYLOAD_PREFIX |  |  |  |  |

| `TOOL_PAYLOAD_LIMITS` | const | TOOL_PAYLOAD_LIMITS |  |  |  |  |

| `isOmittedBinaryPayload` | function | isOmittedBinaryPayload(value: string) |  |  |  |  |

| `toolPayloadSize` | function | toolPayloadSize(value: unknown) |  |  |  |  |

| `CompactedToolPayloads` | interface | interface CompactedToolPayloads |  |  |  |  |

| `ToolPayloadLimits` | interface | interface ToolPayloadLimits |  |  |  |  |

| `ToolPayloadSize` | interface | interface ToolPayloadSize |  |  |  |  |

| `compact` | method | compact(value: unknown, depth = 0, key?: string, binary = false) |  |  |  |  |

| `compactString` | method | compactString(value: string, key?: string, binary = false) |  |  |  |  |

| `exhausted` | method | exhausted() |  |  |  |  |

| `reserveKey` | method | reserveKey(key: string) |  |  |  |  |

| `size` | method | size() |  |  |  |  |

| `agentRender` | function | agentRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `bashRender` | function | bashRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `taskOutputDisplay` | function | taskOutputDisplay(result: unknown) |  |  |  |  |

| `taskOutputRender` | function | taskOutputRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `taskStopRender` | function | taskStopRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `mutationRender` | function | mutationRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `readRender` | function | readRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `searchRender` | function | searchRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `booleanField` | function | booleanField(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `compactStatusLine` | function | compactStatusLine(values: Array<string | undefined>, theme: ZCodeTheme) |  |  |  |  |

| `directText` | function | directText(value: unknown, depth = 0) |  |  |  |  |

| `formatBytes` | function | formatBytes(bytes?: number) |  |  |  |  |

| `formatElapsed` | function | formatElapsed(milliseconds?: number) |  |  |  |  |

| `nestedRecord` | function | nestedRecord(value: unknown, depth = 0) |  |  |  |  |

| `numberField` | function | numberField(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `oneLine` | function | oneLine(value: string, limit = 100) |  |  |  |  |

| `quoted` | function | quoted(value: string) |  |  |  |  |

| `recordString` | function | recordString(record: Record<string, unknown> | undefined, keys: string[]) |  |  |  |  |

| `safeJson` | function | safeJson(value: unknown) |  |  |  |  |

| `toolSummary` | function | toolSummary(name: string, input: unknown) |  |  |  |  |

| `specializedToolRender` | function | specializedToolRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `questionRender` | function | questionRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `sendMessageRender` | function | sendMessageRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `skillRender` | function | skillRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `canonicalToolName` | function | canonicalToolName(name: string) |  |  |  |  |

| `displayNameForMcp` | function | displayNameForMcp(name: string) |  |  |  |  |

| `isAgentDispatchTool` | function | isAgentDispatchTool(name: string | undefined) |  |  |  |  |

| `isGroupedInformationTool` | function | isGroupedInformationTool(name: string) |  |  |  |  |

| `isKnownTool` | function | isKnownTool(name: string) |  |  |  |  |

| `normalizeToolName` | function | normalizeToolName(name: string) |  |  |  |  |

| `toolGroupKind` | function | toolGroupKind(name: string) |  |  |  |  |

| `officialToolNames` | const | officialToolNames |  |  |  |  |

| `SpecializedToolRenderOptions` | interface | interface SpecializedToolRenderOptions |  |  |  |  |

| `SpecializedToolRenderResult` | interface | interface SpecializedToolRenderResult |  |  |  |  |

| `ToolProgressData` | interface | interface ToolProgressData |  |  |  |  |

| `CanonicalToolName` | type | type CanonicalToolName |  |  |  |  |

| `OfficialToolName` | type | type OfficialToolName |  |  |  |  |

| `ToolRenderer` | type | type ToolRenderer |  |  |  |  |

| `linkRows` | function | linkRows(record: Record<string, unknown> | undefined) |  |  |  |  |

| `mcpRender` | function | mcpRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `webFetchRender` | function | webFetchRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `webSearchRender` | function | webSearchRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `goalReadRender` | function | goalReadRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `planModeRender` | function | planModeRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `sessionContextRender` | function | sessionContextRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `todoReadRender` | function | todoReadRender(options: SpecializedToolRenderOptions) |  |  |  |  |

| `ToolTreeView` | class | class ToolTreeView |  |  |  |  |

| `addChild` | method | addChild(child: ToolTreeView) |  |  |  |  |

| `descendantCount` | method | descendantCount() |  |  |  |  |

| `getChildren` | method | getChildren() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `removeChild` | method | removeChild(child: ToolTreeView) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `ToolExecutionView` | class | class ToolExecutionView |  |  |  |  |

| `compactTerminalToolOptions` | function | compactTerminalToolOptions(options: ToolViewOptions) |  |  |  |  |

| `isTerminalToolState` | function | isTerminalToolState(state: string) |  |  |  |  |

| `toolCard` | function | toolCard(options: ToolViewOptions) |  |  |  |  |

| `toolSucceeded` | function | toolSucceeded(value: unknown) |  |  |  |  |

| `ToolViewOptions` | interface | interface ToolViewOptions |  |  |  |  |

| `ensureRebuilt` | method | ensureRebuilt() |  |  |  |  |

| `getName` | method | getName() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `getState` | method | getState() |  |  |  |  |

| `getSummary` | method | getSummary() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `isTerminal` | method | isTerminal() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `update` | method | update(options: ToolViewOptions) |  |  |  |  |

| `Transcript` | class | class Transcript |  |  |  |  |

| `MAX_RETAINED_TRANSCRIPT_BLOCKS` | const | MAX_RETAINED_TRANSCRIPT_BLOCKS |  |  |  |  |

| `MAX_RETAINED_TRANSCRIPT_HISTORY_CHARACTERS` | const | MAX_RETAINED_TRANSCRIPT_HISTORY_CHARACTERS |  |  |  |  |

| `TRANSCRIPT_RENDER_WINDOW_BLOCKS` | const | TRANSCRIPT_RENDER_WINDOW_BLOCKS |  |  |  |  |

| `TranscriptBlockOptions` | interface | interface TranscriptBlockOptions |  |  |  |  |

| `TranscriptCursorStatus` | interface | interface TranscriptCursorStatus |  |  |  |  |

| `TranscriptSearchStatus` | interface | interface TranscriptSearchStatus |  |  |  |  |

| `addBlock` | method | addBlock(component: Component, options: TranscriptBlockOptions = {}) |  |  |  |  |

| `advanceWindow` | method | advanceWindow() |  |  |  |  |

| `associateBlockWithMessage` | method | associateBlockWithMessage(id: string, messageId: string) |  |  |  |  |

| `blockCount` | method | blockCount() |  |  |  |  |

| `blockSearchText` | method | blockSearchText(block: TranscriptBlock) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `clearCursor` | method | clearCursor() |  |  |  |  |

| `clearSearch` | method | clearSearch() |  |  |  |  |

| `cursorStatus` | method | cursorStatus() |  |  |  |  |

| `discardedBlockCount` | method | discardedBlockCount() |  |  |  |  |

| `discardedHistorySuffix` | method | discardedHistorySuffix() |  |  |  |  |

| `enforceRetentionBudget` | method | enforceRetentionBudget() |  |  |  |  |

| `focusedBlockIndex` | method | focusedBlockIndex() |  |  |  |  |

| `historyRetentionHeader` | method | historyRetentionHeader(searchableBlocks: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `matchingBlocks` | method | matchingBlocks(query: string) |  |  |  |  |

| `moveCursor` | method | moveCursor(direction: 1 | -1) |  |  |  |  |

| `movePage` | method | movePage(direction: 1 | -1, width: number) |  |  |  |  |

| `nextSearchMatch` | method | nextSearchMatch(direction: 1 | -1) |  |  |  |  |

| `presentStableBlock` | method | presentStableBlock(block: TranscriptBlock, sourceLines: string[], width: number) |  |  |  |  |

| `refreshSearch` | method | refreshSearch() |  |  |  |  |

| `releaseBlockCache` | method | releaseBlockCache(block: TranscriptBlock) |  |  |  |  |

| `removeBlock` | method | removeBlock(id: string) |  |  |  |  |

| `removeMessage` | method | removeMessage(messageId: string) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `retainedHistoryCharacters` | method | retainedHistoryCharacters() |  |  |  |  |

| `searchFor` | method | searchFor(query: string) |  |  |  |  |

| `searchStatus` | method | searchStatus() |  |  |  |  |

| `selectLatest` | method | selectLatest() |  |  |  |  |

| `selectedText` | method | selectedText() |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setNavigationViewportRows` | method | setNavigationViewportRows(rows: number) |  |  |  |  |

| `stickyPrompt` | method | stickyPrompt(before: number) |  |  |  |  |

| `toggleExpanded` | method | toggleExpanded() |  |  |  |  |

| `toggleFocusedExpanded` | method | toggleFocusedExpanded() |  |  |  |  |

| `visibleSelection` | method | visibleSelection() |  |  |  |  |

| `TuiMode` | type | type TuiMode |  |  |  |  |

| `TurnDiffStore` | class | class TurnDiffStore |  |  |  |  |

| `MAX_RETAINED_TURN_DIFFS` | const | MAX_RETAINED_TURN_DIFFS |  |  |  |  |

| `TurnDiffSnapshot` | interface | interface TurnDiffSnapshot |  |  |  |  |

| `beginTurn` | method | beginTurn(prompt?: string) |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `enforceCurrentBudget` | method | enforceCurrentBudget() |  |  |  |  |

| `finishTurn` | method | finishTurn() |  |  |  |  |

| `snapshots` | method | snapshots() |  |  |  |  |

| `upsertTool` | method | upsertTool(toolCallId: string, diffs: FileDiffData[]) |  |  |  |  |

| `TurnPresentationRegistry` | class | class TurnPresentationRegistry |  |  |  |  |

| `TurnPresentationRegistrySizes` | interface | interface TurnPresentationRegistrySizes |  |  |  |  |

| `beginTurn` | method | beginTurn() |  |  |  |  |

| `clear` | method | clear() |  |  |  |  |

| `sizes` | method | sizes() |  |  |  |  |

| `TURN_TIMER_FRAME_DURATION_MS` | const | TURN_TIMER_FRAME_DURATION_MS |  |  |  |  |

| `formatElapsed` | function | formatElapsed(milliseconds: number) |  |  |  |  |

| `turnTimerFrame` | function | turnTimerFrame(elapsedMilliseconds: number, animated = false) |  |  |  |  |

| `TurnWorkTracker` | class | class TurnWorkTracker |  |  |  |  |

| `accepts` | method | accepts(turnId: string | undefined) |  |  |  |  |

| `begin` | method | begin() |  |  |  |  |

| `bindTurn` | method | bindTurn(turnId: string | undefined) |  |  |  |  |

| `cancel` | method | cancel() |  |  |  |  |

| `finishForeground` | method | finishForeground(awaitProjection: boolean) |  |  |  |  |

| `handle` | method | handle(event: StreamEvent) |  |  |  |  |

| `isActive` | method | isActive() |  |  |  |  |

| `ownsTask` | method | ownsTask(taskId: string | undefined) |  |  |  |  |

| `reconcile` | method | reconcile(projection: RuntimeProjectionSnapshot) |  |  |  |  |

| `asString` | function | asString(value: unknown) |  |  |  |  |

| `isRecord` | function | isRecord(value: unknown) |  |  |  |  |

| `InterruptTurnOptions` | interface | interface InterruptTurnOptions |  |  |  |  |

| `PromptCallOptions` | interface | interface PromptCallOptions |  |  |  |  |

| `RuntimeAdapter` | interface | interface RuntimeAdapter |  |  |  |  |

| `SkillSuggestion` | interface | interface SkillSuggestion |  |  |  |  |

| `SkillSuggestionResult` | interface | interface SkillSuggestionResult |  |  |  |  |

| `SlashCommandOption` | interface | interface SlashCommandOption |  |  |  |  |

| `TuiOptions` | interface | interface TuiOptions |  |  |  |  |

| `WorkspacePathSuggestion` | interface | interface WorkspacePathSuggestion |  |  |  |  |

| `WorkspacePathSuggestionRequest` | interface | interface WorkspacePathSuggestionRequest |  |  |  |  |

| `WorkspacePathSuggestionResult` | interface | interface WorkspacePathSuggestionResult |  |  |  |  |

| `ListPluginReferences` | type | type ListPluginReferences |  |  |  |  |

| `ListSkills` | type | type ListSkills |  |  |  |  |

| `ListWorkspacePathSuggestions` | type | type ListWorkspacePathSuggestions |  |  |  |  |

| `UnknownRecord` | type | type UnknownRecord |  |  |  |  |

| `UpdateAvailableView` | class | class UpdateAvailableView |  |  |  |  |

| `releaseNotesUrl` | const | releaseNotesUrl |  |  |  |  |

| `updateCommand` | const | updateCommand |  |  |  |  |

| `Divider` | class | class Divider |  |  |  |  |

| `WelcomeBanner` | class | class WelcomeBanner |  |  |  |  |

| `BRAND_MARK` | const | BRAND_MARK |  |  |  |  |

| `BRAND_MARK_WIDTH` | const | BRAND_MARK_WIDTH |  |  |  |  |

| `WIDE_BANNER_MIN_WIDTH` | const | WIDE_BANNER_MIN_WIDTH |  |  |  |  |

| `WelcomeBannerOptions` | interface | interface WelcomeBannerOptions |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `locationLine` | method | locationLine(width: number) |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `renderCompact` | method | renderCompact(width: number) |  |  |  |  |

| `renderWide` | method | renderWide(width: number) |  |  |  |  |

| `WorkDurationView` | class | class WorkDurationView |  |  |  |  |

| `workedDurationLabel` | function | workedDurationLabel(elapsedMilliseconds: number) |  |  |  |  |

| `invalidate` | method | invalidate() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `WorkspaceAutocompleteProvider` | class | class WorkspaceAutocompleteProvider |  |  |  |  |

| `shouldTriggerFileCompletion` | method | shouldTriggerFileCompletion(lines: string[], cursorLine: number, cursorCol: number) |  |  |  |  |

| `parseWorkspaceDiff` | function | parseWorkspaceDiff(patchText: string, statusText: string, truncated = false) |  |  |  |  |

| `readWorkspaceDiff` | function | readWorkspaceDiff(workspaceDirectory: string) |  |  |  |  |

| `WorkspaceDiffSnapshot` | interface | interface WorkspaceDiffSnapshot |  |  |  |  |

| `benchSize` | function | benchSize(parts: number, runs: number) |  |  |  |  |

| `syntheticGraph` | function | syntheticGraph(parts: number, seed = 26_926) |  |  |  |  |

| `BenchRow` | interface | interface BenchRow |  |  |  |  |

| `benchRepository` | function | benchRepository(runs: number) |  |  |  |  |

| `benchSynthetic` | function | benchSynthetic(jobs: number, runs: number) |  |  |  |  |

| `syntheticSubjects` | function | syntheticSubjects(jobs: number, seed = 26926) |  |  |  |  |

| `BenchRow` | interface | interface BenchRow |  |  |  |  |

| `append` | method | append(delta: string) |  |  |  |  |

| `complete` | method | complete() |  |  |  |  |

| `getSearchText` | method | getSearchText() |  |  |  |  |

| `hasHiddenContent` | method | hasHiddenContent() |  |  |  |  |

| `isExpanded` | method | isExpanded() |  |  |  |  |

| `rebuild` | method | rebuild() |  |  |  |  |

| `render` | method | render(width: number) |  |  |  |  |

| `setExpanded` | method | setExpanded(expanded: boolean) |  |  |  |  |

| `setText` | method | setText(text: string) |  |  |  |  |

| `validatePackageTree` | function | validatePackageTree(base = root) |  |  |  |  |

| `DEFAULT_PACK_ROOT` | const | DEFAULT_PACK_ROOT |  |  |  |  |

| `RELOCATION` | const | RELOCATION |  |  |  |  |

| `generateInto` | function | generateInto(work: string, ontologyPath = join(root, "ontology", "zcode-loop.ttl") |  |  |  |  |

| `ggenToml` | function | ggenToml(ontologyFile: string, env: Record<string, string | undefined> = process.env) |  |  |  |  |

| `packDir` | function | packDir(name: string, key: string, env: Record<string, string | undefined> = process.env) |  |  |  |  |

| `relocate` | function | relocate(work: string, dest: string) |  |  |  |  |

| `packRelease` | function | packRelease(base = root) |  |  |  |  |

| `parsePackResult` | function | parsePackResult(stdout: string) |  |  |  |  |

| `validatePackResult` | function | validatePackResult(result: PackResult, packageJson: PackageIdentity) |  |  |  |  |

| `PackFile` | interface | interface PackFile |  |  |  |  |

| `PackResult` | interface | interface PackResult |  |  |  |  |

| `attributionFiles` | const | attributionFiles |  |  |  |  |

| `pluginLicenseFiles` | const | pluginLicenseFiles |  |  |  |  |

| `publishedFiles` | const | publishedFiles |  |  |  |  |

| `compareReleaseVersions` | function | compareReleaseVersions(left: string, right: string) |  |  |  |  |

| `nextBuildVersion` | function | nextBuildVersion(currentVersion: string) |  |  |  |  |

| `parseReleaseVersion` | function | parseReleaseVersion(version: string) |  |  |  |  |

| `syncedReleaseVersion` | function | syncedReleaseVersion(appVersion: string, currentVersion: string) |  |  |  |  |

| `ReleaseVersion` | interface | interface ReleaseVersion |  |  |  |  |

| `runtimeModificationNotice` | const | runtimeModificationNotice |  |  |  |  |

| `markRuntimeModified` | function | markRuntimeModified(source: string) |  |  |  |  |

| `smokePackagedCli` | function | smokePackagedCli(tarball: string) |  |  |  |  |

| `RuntimePatchError` | class | class RuntimePatchError |  |  |  |  |

| `defaultAgentAutoBackgroundMs` | const | defaultAgentAutoBackgroundMs |  |  |  |  |

| `runtimePatchPlan` | const | runtimePatchPlan |  |  |  |  |

| `sqliteBusyTimeoutMs` | const | sqliteBusyTimeoutMs |  |  |  |  |

| `chooseArtifact` | function | chooseArtifact(manifest: UpdateManifest, platform: SyncOptions["platform"]) |  |  |  |  |

| `extractRuntimeCapabilities` | function | extractRuntimeCapabilities(runtime: string) |  |  |  |  |

| `formatRuntimeCompatibilityFailure` | function | formatRuntimeCompatibilityFailure(report: RuntimeCompatibilityFailure) |  |  |  |  |

| `hasRuntimeAttachSessionMetadataNullGuard` | function | hasRuntimeAttachSessionMetadataNullGuard(runtime: string) |  |  |  |  |

| `hasRuntimeCliHelpContract` | function | hasRuntimeCliHelpContract(runtime: string) |  |  |  |  |

| `hasRuntimeHttpNoContentGuard` | function | hasRuntimeHttpNoContentGuard(runtime: string) |  |  |  |  |

| `hasRuntimeModelCatalogReload` | function | hasRuntimeModelCatalogReload(runtime: string) |  |  |  |  |

| `hasRuntimeNetworkRetryGuard` | function | hasRuntimeNetworkRetryGuard(runtime: string) |  |  |  |  |

| `hasRuntimeRegistryLoginModelDefaults` | function | hasRuntimeRegistryLoginModelDefaults(runtime: string) |  |  |  |  |

| `hasRuntimeSqliteBusyTimeout` | function | hasRuntimeSqliteBusyTimeout(runtime: string) |  |  |  |  |

| `hasRuntimeStreamEofFinishGuard` | function | hasRuntimeStreamEofFinishGuard(runtime: string) |  |  |  |  |

| `hasRuntimeTuiMetadataTurnNullGuard` | function | hasRuntimeTuiMetadataTurnNullGuard(runtime: string) |  |  |  |  |

| `installRuntimeProviderConfig` | function | installRuntimeProviderConfig(glm: string, nextVendor: string) |  |  |  |  |

| `manifestUrl` | function | manifestUrl(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `parseArgs` | function | parseArgs(argv: string[]) |  |  |  |  |

| `parseRuntimeLock` | function | parseRuntimeLock(value: unknown) |  |  |  |  |

| `parseRuntimePatchReports` | function | parseRuntimePatchReports(value: unknown) |  |  |  |  |

| `patchRuntimeAgentAutoBackground` | function | patchRuntimeAgentAutoBackground(runtime: string) |  |  |  |  |

| `patchRuntimeAttachSessionMetadataNullGuard` | function | patchRuntimeAttachSessionMetadataNullGuard(runtime: string) |  |  |  |  |

| `patchRuntimeBuiltinProviderAliases` | function | patchRuntimeBuiltinProviderAliases(runtime: string) |  |  |  |  |

| `patchRuntimeCliHelpContract` | function | patchRuntimeCliHelpContract(runtime: string) |  |  |  |  |

| `patchRuntimeDetachedAgentLifecycle` | function | patchRuntimeDetachedAgentLifecycle(runtime: string) |  |  |  |  |

| `patchRuntimeExpertStrategyConfig` | function | patchRuntimeExpertStrategyConfig(runtime: string) |  |  |  |  |

| `patchRuntimeGoalFailurePause` | function | patchRuntimeGoalFailurePause(runtime: string) |  |  |  |  |

| `patchRuntimeHttpNoContent` | function | patchRuntimeHttpNoContent(runtime: string) |  |  |  |  |

| `patchRuntimeLoginModelDefaults` | function | patchRuntimeLoginModelDefaults(runtime: string) |  |  |  |  |

| `patchRuntimeMaxTurnsEnforcement` | function | patchRuntimeMaxTurnsEnforcement(runtime: string) |  |  |  |  |

| `patchRuntimeModelCatalogReload` | function | patchRuntimeModelCatalogReload(runtime: string) |  |  |  |  |

| `patchRuntimeNetworkRetryClassification` | function | patchRuntimeNetworkRetryClassification(runtime: string) |  |  |  |  |

| `patchRuntimeOAuthHttpErrors` | function | patchRuntimeOAuthHttpErrors(runtime: string) |  |  |  |  |

| `patchRuntimeOfficialMcpAvailability` | function | patchRuntimeOfficialMcpAvailability(runtime: string) |  |  |  |  |

| `patchRuntimeSessionModelRecovery` | function | patchRuntimeSessionModelRecovery(runtime: string) |  |  |  |  |

| `patchRuntimeSharedConfig` | function | patchRuntimeSharedConfig(runtime: string) |  |  |  |  |

| `patchRuntimeSqliteBusyTimeout` | function | patchRuntimeSqliteBusyTimeout(runtime: string) |  |  |  |  |

| `patchRuntimeStreamEofFinishGuard` | function | patchRuntimeStreamEofFinishGuard(runtime: string) |  |  |  |  |

| `patchRuntimeStreamingLedgerForwarding` | function | patchRuntimeStreamingLedgerForwarding(runtime: string) |  |  |  |  |

| `patchRuntimeSubagentMaxTurns` | function | patchRuntimeSubagentMaxTurns(runtime: string) |  |  |  |  |

| `patchRuntimeTerminalToolProjection` | function | patchRuntimeTerminalToolProjection(runtime: string) |  |  |  |  |

| `patchRuntimeTuiBridge` | function | patchRuntimeTuiBridge(runtime: string) |  |  |  |  |

| `patchRuntimeTuiExecutionState` | function | patchRuntimeTuiExecutionState(runtime: string) |  |  |  |  |

| `patchRuntimeTuiMetadataTurnNullGuard` | function | patchRuntimeTuiMetadataTurnNullGuard(runtime: string) |  |  |  |  |

| `patchRuntimeZaiDesktopOAuth` | function | patchRuntimeZaiDesktopOAuth(runtime: string) |  |  |  |  |

| `resolveArtifactUrl` | function | resolveArtifactUrl(manifestHref: string, artifactHref: string) |  |  |  |  |

| `selectRuntimeLock` | function | selectRuntimeLock(candidate: RuntimeLock, current?: RuntimeLock) |  |  |  |  |

| `serviceManifestUrl` | function | serviceManifestUrl(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `serviceReleasePlatform` | function | serviceReleasePlatform(platform: SyncOptions["platform"], arch: string) |  |  |  |  |

| `supportsMultiMessageFileRewind` | function | supportsMultiMessageFileRewind(runtime: string) |  |  |  |  |

| `RuntimeCompatibilityFailure` | interface | interface RuntimeCompatibilityFailure |  |  |  |  |

| `RuntimeLock` | interface | interface RuntimeLock |  |  |  |  |

| `RuntimeManifestResolution` | interface | interface RuntimeManifestResolution |  |  |  |  |

| `RuntimePatchDefinition` | interface | interface RuntimePatchDefinition |  |  |  |  |

| `RuntimePatchReport` | interface | interface RuntimePatchReport |  |  |  |  |

| `SyncOptions` | interface | interface SyncOptions |  |  |  |  |

| `RuntimePatchRequirement` | type | type RuntimePatchRequirement |  |  |  |  |

| `RuntimePatchStatus` | type | type RuntimePatchStatus |  |  |  |  |

| `TUI_PERF_LIMITS` | const | TUI_PERF_LIMITS |  |  |  |  |

| `verifyTuiPerf` | function | verifyTuiPerf() |  |  |  |  |

| `TuiPerfGateResult` | interface | interface TuiPerfGateResult |  |  |  |  |

| `compositeShell` | const | compositeShell |  |  |  |  |

| `dynamicScriptRef` | const | dynamicScriptRef |  |  |  |  |

| `inlinePinMarkers` | const | inlinePinMarkers |  |  |  |  |

| `pinnedLinuxX64Sha256` | const | pinnedLinuxX64Sha256 |  |  |  |  |

| `pinnedMarketplaceSha` | const | pinnedMarketplaceSha |  |  |  |  |

| `toolchainAction` | const | toolchainAction |  |  |  |  |

| `toolchainActionPath` | const | toolchainActionPath |  |  |  |  |

| `compositeCourt` | function | compositeCourt(action: CompositeAction) |  |  |  |  |

| `failureTolerated` | function | failureTolerated(subject: { "continue-on-error"?: boolean | string }) |  |  |  |  |

| `mutate` | function | mutate(subjects: WorkflowSubject[], name: string, edit: (source: string) |  |  |  |  |

| `packageScripts` | function | packageScripts() |  |  |  |  |

| `readToolchainAction` | function | readToolchainAction() |  |  |  |  |

| `readWorkflowSubjects` | function | readWorkflowSubjects() |  |  |  |  |

| `requireToolchainsValue` | function | requireToolchainsValue(value: unknown) |  |  |  |  |

| `requiresToolchain` | function | requiresToolchain(step: WorkflowStep, job: WorkflowJob, workflow: Workflow, scripts: Set<string>) |  |  |  |  |

| `scriptRefs` | function | scriptRefs(command: string) |  |  |  |  |

| `setsRequireToolchains` | function | setsRequireToolchains(command: string) |  |  |  |  |

| `toolchainCourt` | function | toolchainCourt(subjects: WorkflowSubject[], scripts: Set<string>) |  |  |  |  |

| `toolchainScripts` | function | toolchainScripts(scripts: Record<string, string>) |  |  |  |  |

| `CompositeAction` | interface | interface CompositeAction |  |  |  |  |

| `ToolchainViolation` | interface | interface ToolchainViolation |  |  |  |  |

| `Workflow` | interface | interface Workflow |  |  |  |  |

| `WorkflowJob` | interface | interface WorkflowJob |  |  |  |  |

| `WorkflowStep` | interface | interface WorkflowStep |  |  |  |  |

| `WorkflowSubject` | interface | interface WorkflowSubject |  |  |  |  |

| `runtimePath` | const | runtimePath |  |  |  |  |

| `readRuntimeEvents` | function | readRuntimeEvents(path = runtimePath) |  |  |  |  |

| `runtimeAvailable` | function | runtimeAvailable() |  |  |  |  |

| `wireOf` | function | wireOf(events: RuntimeEvents, internalValue: string) |  |  |  |  |

| `RuntimeEvents` | interface | interface RuntimeEvents |  |  |  |  |

| `AppServerCancellationError` | class | class AppServerCancellationError |  |  |  |  |

| `AppServerProcessError` | class | class AppServerProcessError |  |  |  |  |

| `AppServerRequestError` | class | class AppServerRequestError |  |  |  |  |

| `requestAppServer` | function | requestAppServer(request: AppServerRequest) |  |  |  |  |

| `AppServerRequest` | interface | interface AppServerRequest |  |  |  |  |

| `AppServerTransport` | interface | interface AppServerTransport |  |  |  |  |

| `builtinCodingPlanFamilies` | const | builtinCodingPlanFamilies |  |  |  |  |

| `BuiltinCodingPlanFamily` | type | type BuiltinCodingPlanFamily |  |  |  |  |

| `captureCommand` | function | captureCommand(command: string, args: string[]) |  |  |  |  |

| `CommandResult` | interface | interface CommandResult |  |  |  |  |

| `cliSettingsPath` | function | cliSettingsPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |

| `desktopSettingsPath` | function | desktopSettingsPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `legacyCliConfigPath` | function | legacyCliConfigPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerConfigPath` | function | providerConfigPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |

| `providerMigrationMarkerPath` | function | providerMigrationMarkerPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `readDesktopSettings` | function | readDesktopSettings(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `settingsMigrationMarkerPath` | function | settingsMigrationMarkerPath(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `sharedDataBaseDir` | function | sharedDataBaseDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, fallbackHome = homedir() |  |  |  |  |

| `DarwinUrlCallbackOptions` | interface | interface DarwinUrlCallbackOptions |  |  |  |  |

| `DarwinUrlCallbackReceiver` | interface | interface DarwinUrlCallbackReceiver |  |  |  |  |

| `CommandRunner` | type | type CommandRunner |  |  |  |  |

| `runEvidenceCommand` | function | runEvidenceCommand(args: string[]) |  |  |  |  |

| `verifyEvidenceBundle` | function | verifyEvidenceBundle(path: string) |  |  |  |  |

| `EvidenceAdmissionReceipt` | interface | interface EvidenceAdmissionReceipt |  |  |  |  |

| `DEFAULT_EXECUTION_PROVIDER` | const | DEFAULT_EXECUTION_PROVIDER |  |  |  |  |

| `builtinExecutionProvider` | function | builtinExecutionProvider() |  |  |  |  |

| `parseExecutionProviderRegistry` | function | parseExecutionProviderRegistry(text: string) |  |  |  |  |

| `ExecutionProviderRead` | interface | interface ExecutionProviderRead |  |  |  |  |

| `ExecutionProviderRegistry` | interface | interface ExecutionProviderRegistry |  |  |  |  |

| `ExecutionProviderRule` | interface | interface ExecutionProviderRule |  |  |  |  |

| `ExecutionProviderSelection` | interface | interface ExecutionProviderSelection |  |  |  |  |

| `ReadConfigText` | type | type ReadConfigText |  |  |  |  |

| `runGallCommand` | function | runGallCommand(args: string[]) |  |  |  |  |

| `verifyGallBundle` | function | verifyGallBundle(bundleDir: string) |  |  |  |  |

| `verifyPortableGallArtifact` | function | verifyPortableGallArtifact(path: string) |  |  |  |  |

| `GallFreshConsumerReceipt` | interface | interface GallFreshConsumerReceipt |  |  |  |  |

| `LeaseConflictError` | class | class LeaseConflictError |  |  |  |  |

| `defaultFabricUrl` | const | defaultFabricUrl |  |  |  |  |

| `gallWorkContractSha256` | const | gallWorkContractSha256 |  |  |  |  |

| `gallWorkUsage` | const | gallWorkUsage |  |  |  |  |

| `clearLeaseFiles` | function | clearLeaseFiles(cwd: string) |  |  |  |  |

| `constructPrompt` | function | constructPrompt(workOrderPathValue: string) |  |  |  |  |

| `gitHead` | function | gitHead(cwd: string) |  |  |  |  |

| `isGallWorkInvocation` | function | isGallWorkInvocation(args: string[]) |  |  |  |  |

| `leaseFilePaths` | function | leaseFilePaths(cwd: string) |  |  |  |  |

| `leaseFilePathsKeyed` | function | leaseFilePathsKeyed(cwd: string, leaseId: string | undefined) |  |  |  |  |

| `leaseIdFromEnv` | function | leaseIdFromEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `parseGallWorkArgs` | function | parseGallWorkArgs(args: string[], env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `parseGallWorkLease` | function | parseGallWorkLease(value: unknown) |  |  |  |  |

| `resolveFabricTarget` | function | resolveFabricTarget(env: NodeJS.ProcessEnv = process.env, configPath?: string) |  |  |  |  |

| `saveLeaseFiles` | function | saveLeaseFiles(cwd: string, claim: Record<string, unknown>) |  |  |  |  |

| `standingForOutcome` | function | standingForOutcome(outcome: string) |  |  |  |  |

| `workOrderPath` | function | workOrderPath(cwd: string) |  |  |  |  |

| `ConstructOutcome` | interface | interface ConstructOutcome |  |  |  |  |

| `ConstructRunOptions` | interface | interface ConstructRunOptions |  |  |  |  |

| `FabricCallOutcome` | interface | interface FabricCallOutcome |  |  |  |  |

| `FabricCapabilities` | interface | interface FabricCapabilities |  |  |  |  |

| `FabricTarget` | interface | interface FabricTarget |  |  |  |  |

| `GallWorkIo` | interface | interface GallWorkIo |  |  |  |  |

| `GallWorkLease` | interface | interface GallWorkLease |  |  |  |  |

| `GallWorkRequest` | interface | interface GallWorkRequest |  |  |  |  |

| `GallWorkResult` | interface | interface GallWorkResult |  |  |  |  |

| `LeaseReconciliation` | interface | interface LeaseReconciliation |  |  |  |  |

| `ConstructOverride` | type | type ConstructOverride |  |  |  |  |

| `FabricCall` | type | type FabricCall |  |  |  |  |

| `FetchLike` | type | type FetchLike |  |  |  |  |

| `LifecycleEmit` | type | type LifecycleEmit |  |  |  |  |

| `CHAIN_ALGO` | const | CHAIN_ALGO |  |  |  |  |

| `MxLoopInitial` | const | MxLoopInitial |  |  |  |  |

| `MxLoopTransitions` | const | MxLoopTransitions |  |  |  |  |

| `ZcodeTurnInitial` | const | ZcodeTurnInitial |  |  |  |  |

| `ZcodeTurnTransitions` | const | ZcodeTurnTransitions |  |  |  |  |

| `MxLoopState` | enum | enum MxLoopState |  |  |  |  |

| `ZcodeTurnState` | enum | enum ZcodeTurnState |  |  |  |  |

| `chainDigest` | function | chainDigest(data: string) |  |  |  |  |

| `chainEvents` | function | chainEvents(events: ReadonlyArray<string>) |  |  |  |  |

| `replayMxLoop` | function | replayMxLoop(events: ReadonlyArray<TransitionEvent>) |  |  |  |  |

| `replayZcodeTurn` | function | replayZcodeTurn(events: ReadonlyArray<TransitionEvent>) |  |  |  |  |

| `stepMxLoop` | function | stepMxLoop(state: MxLoopState, name: string, ctx: Record<string, boolean>) |  |  |  |  |

| `stepZcodeTurn` | function | stepZcodeTurn(state: ZcodeTurnState, name: string, ctx: Record<string, boolean>) |  |  |  |  |

| `TransitionEvent` | type | type TransitionEvent |  |  |  |  |

| `Violation` | type | type Violation |  |  |  |  |

| `Tap` | class | class Tap |  |  |  |  |

| `CALLBACK_KINDS` | const | CALLBACK_KINDS |  |  |  |  |

| `CLOSES` | const | CLOSES |  |  |  |  |

| `EVENT_TYPES` | const | EVENT_TYPES |  |  |  |  |

| `OBJECT_TYPES` | const | OBJECT_TYPES |  |  |  |  |

| `PHASED` | const | PHASED |  |  |  |  |

| `PHASE_CLOSE` | const | PHASE_CLOSE |  |  |  |  |

| `PHASE_OPEN` | const | PHASE_OPEN |  |  |  |  |

| `RULES` | const | RULES |  |  |  |  |

| `SOURCES` | const | SOURCES |  |  |  |  |

| `SUPPORTED_HASHES` | const | SUPPORTED_HASHES |  |  |  |  |

| `canon` | function | canon(e: { id: string; type: string; time: string; relationships: Relationship[] }, phase = "", ref = "") |  |  |  |  |

| `hashHex` | function | hashHex(alg: string, data: string) |  |  |  |  |

| `verifyChain` | function | verifyChain(doc: OcelDoc, alg: string) |  |  |  |  |

| `append` | method | append(raw0: unknown) |  |  |  |  |

| `attr` | method | attr(e: OcelEvent, n: string) |  |  |  |  |

| `closedRefs` | method | closedRefs() |  |  |  |  |

| `ingest` | method | ingest(input: string | object) |  |  |  |  |

| `openPending` | method | openPending(outcome: string, rels: Relationship[]) |  |  |  |  |

| `seal` | method | seal() |  |  |  |  |

| `serialize` | method | serialize() |  |  |  |  |

| `toOcel` | method | toOcel() |  |  |  |  |

| `unpaired` | method | unpaired() |  |  |  |  |

| `Attribute` | type | type Attribute |  |  |  |  |

| `OcelDoc` | type | type OcelDoc |  |  |  |  |

| `OcelEvent` | type | type OcelEvent |  |  |  |  |

| `Relationship` | type | type Relationship |  |  |  |  |

| `RuleSpec` | type | type RuleSpec |  |  |  |  |

| `SourceSpec` | type | type SourceSpec |  |  |  |  |

| `ALGORITHM` | const | ALGORITHM |  |  |  |  |

| `FIELDS` | const | FIELDS |  |  |  |  |

| `GENESIS` | const | GENESIS |  |  |  |  |

| `NEUTRAL` | const | NEUTRAL |  |  |  |  |

| `PHASES` | const | PHASES |  |  |  |  |

| `STANDINGS` | const | STANDINGS |  |  |  |  |

| `isSealed` | const | isSealed |  |  |  |  |

| `appendOutcome` | function | appendOutcome(chain: Chain, entry_id: string, standing: string, subject: string, action: string) |  |  |  |  |

| `appendPending` | function | appendPending(chain: Chain, entry_id: string, subject: string, action: string) |  |  |  |  |

| `canonical` | function | canonical(e: Record<string, unknown>) |  |  |  |  |

| `digest` | function | digest(text: string) |  |  |  |  |

| `seal` | function | seal(chain: Chain, entry_id: string, standing: string, subject: string) |  |  |  |  |

| `unpaired` | function | unpaired(chain: Chain) |  |  |  |  |

| `verify` | function | verify(chain: Chain) |  |  |  |  |

| `Entry` | interface | interface Entry |  |  |  |  |

| `Chain` | type | type Chain |  |  |  |  |

| `firstRunSetupEnv` | function | firstRunSetupEnv(setupPending: boolean, args: string[]) |  |  |  |  |

| `formatVersionOutput` | function | formatVersionOutput(distributionVersion: string, runtimeVersion: string) |  |  |  |  |

| `isVersionInvocation` | function | isVersionInvocation(args: string[]) |  |  |  |  |

| `main` | function | main(args: string[]) |  |  |  |  |

| `normalizeLoginArgs` | function | normalizeLoginArgs(args: string[]) |  |  |  |  |

| `readDistributionVersion` | function | readDistributionVersion(manifestPath = packageManifestPath) |  |  |  |  |

| `readRuntimeVersion` | function | readRuntimeVersion(metadataPath = extractionMetadataPath) |  |  |  |  |

| `resolveModelRetryMaxRetries` | function | resolveModelRetryMaxRetries(env: NodeJS.ProcessEnv) |  |  |  |  |

| `resolveNodeExecutable` | function | resolveNodeExecutable() |  |  |  |  |

| `resolveZCodeBaseUrl` | function | resolveZCodeBaseUrl(env: NodeJS.ProcessEnv) |  |  |  |  |

| `extractMaxTurns` | function | extractMaxTurns(args: string[]) |  |  |  |  |

| `readSubagentMaxTurnsSetting` | function | readSubagentMaxTurnsSetting(settingsPath: string) |  |  |  |  |

| `resolveSubagentMaxTurnsEnv` | function | resolveSubagentMaxTurnsEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `MaxTurnsExtraction` | interface | interface MaxTurnsExtraction |  |  |  |  |

| `hasConfiguredProviderAccess` | function | hasConfiguredProviderAccess(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerConfigPathHint` | function | providerConfigPathHint(platform: NodeJS.Platform = process.platform) |  |  |  |  |

| `readConfiguredModelAccess` | function | readConfiguredModelAccess(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `CliSettingsBootstrapResult` | interface | interface CliSettingsBootstrapResult |  |  |  |  |

| `ConfiguredModelAccess` | interface | interface ConfiguredModelAccess |  |  |  |  |

| `CliSettingsRecord` | type | type CliSettingsRecord |  |  |  |  |

| `OcelRecorder` | class | class OcelRecorder |  |  |  |  |

| `APP_SERVER_SOURCE` | const | APP_SERVER_SOURCE |  |  |  |  |

| `GALL_WORK_SOURCE` | const | GALL_WORK_SOURCE |  |  |  |  |

| `STREAM_SOURCE` | const | STREAM_SOURCE |  |  |  |  |

| `leaseIdentityFromEnv` | function | leaseIdentityFromEnv(env: NodeJS.ProcessEnv) |  |  |  |  |

| `normalizeRecord` | function | normalizeRecord(record: unknown) |  |  |  |  |

| `ocelDirectory` | function | ocelDirectory(env: NodeJS.ProcessEnv) |  |  |  |  |

| `ocelEnabled` | function | ocelEnabled(env: NodeJS.ProcessEnv) |  |  |  |  |

| `ocelSourceForArgs` | function | ocelSourceForArgs(args: readonly string[]) |  |  |  |  |

| `redactSecrets` | function | redactSecrets(text: string) |  |  |  |  |

| `sessionOf` | function | sessionOf(record: unknown) |  |  |  |  |

| `startOcelTap` | function | startOcelTap(args: readonly string[], env: NodeJS.ProcessEnv) |  |  |  |  |

| `subjectHead` | function | subjectHead(cwd: string | undefined) |  |  |  |  |

| `toEx4pmReceipt` | function | toEx4pmReceipt(entry: Entry) |  |  |  |  |

| `LeaseIdentity` | interface | interface LeaseIdentity |  |  |  |  |

| `feed` | method | feed(record: unknown) |  |  |  |  |

| `feedLine` | method | feedLine(line: string) |  |  |  |  |

| `finish` | method | finish() |  |  |  |  |

| `write` | method | write(chunk: string) |  |  |  |  |

| `OcelResult` | type | type OcelResult |  |  |  |  |

| `inspectSemanticPart` | function | inspectSemanticPart(graphValue: unknown, partRef: string) |  |  |  |  |

| `runPartsCommand` | function | runPartsCommand(args: string[]) |  |  |  |  |

| `PartAlternative` | interface | interface PartAlternative |  |  |  |  |

| `SemanticFalsifierResult` | interface | interface SemanticFalsifierResult |  |  |  |  |

| `PluginRequestInput` | interface | interface PluginRequestInput |  |  |  |  |

| `RunPluginCommandOptions` | interface | interface RunPluginCommandOptions |  |  |  |  |

| `pluginProtocolMethods` | const | pluginProtocolMethods |  |  |  |  |

| `pluginWorkspace` | function | pluginWorkspace(path: string) |  |  |  |  |

| `PluginReferenceCatalogResult` | interface | interface PluginReferenceCatalogResult |  |  |  |  |

| `PluginReferenceSummary` | interface | interface PluginReferenceSummary |  |  |  |  |

| `PluginWorkspace` | interface | interface PluginWorkspace |  |  |  |  |

| `ConcurrencyCap` | class | class ConcurrencyCap |  |  |  |  |

| `ProviderCapacityRefusal` | class | class ProviderCapacityRefusal |  |  |  |  |

| `defaultBackoffPolicy` | const | defaultBackoffPolicy |  |  |  |  |

| `defaultFabricConcurrencyLimit` | const | defaultFabricConcurrencyLimit |  |  |  |  |

| `capacityFromBody` | function | capacityFromBody(body: unknown) |  |  |  |  |

| `capacityFromStatus` | function | capacityFromStatus(status: number) |  |  |  |  |

| `isProviderCapacityRefusal` | function | isProviderCapacityRefusal(value: unknown) |  |  |  |  |

| `BackoffPolicy` | interface | interface BackoffPolicy |  |  |  |  |

| `CallWithCapacityBackoffOptions` | interface | interface CallWithCapacityBackoffOptions |  |  |  |  |

| `CapacitySignal` | interface | interface CapacitySignal |  |  |  |  |

| `inFlightCount` | method | inFlightCount() |  |  |  |  |

| `CapacityCode` | type | type CapacityCode |  |  |  |  |

| `RelayLockError` | class | class RelayLockError |  |  |  |  |

| `RelayStateError` | class | class RelayStateError |  |  |  |  |

| `RelayWorker` | class | class RelayWorker |  |  |  |  |

| `ADMISSION_ORDER` | const | ADMISSION_ORDER |  |  |  |  |

| `KNOWN_REPLAY` | const | KNOWN_REPLAY |  |  |  |  |

| `RELAY_ACTUATE_VERB` | const | RELAY_ACTUATE_VERB |  |  |  |  |

| `RELAY_ALLOW_DO_ENV` | const | RELAY_ALLOW_DO_ENV |  |  |  |  |

| `RELAY_CHANNELS` | const | RELAY_CHANNELS |  |  |  |  |

| `RELAY_CONTRACT` | const | RELAY_CONTRACT |  |  |  |  |

| `RELAY_CONTRACT_VERSION` | const | RELAY_CONTRACT_VERSION |  |  |  |  |

| `RELAY_ENVELOPE_REQUIRED` | const | RELAY_ENVELOPE_REQUIRED |  |  |  |  |

| `RELAY_ENVELOPE_SCHEMA` | const | RELAY_ENVELOPE_SCHEMA |  |  |  |  |

| `RELAY_OCEL_IDENTITY_ENV` | const | RELAY_OCEL_IDENTITY_ENV |  |  |  |  |

| `RELAY_REFUSALS` | const | RELAY_REFUSALS |  |  |  |  |

| `RELAY_STATE_SCHEMA` | const | RELAY_STATE_SCHEMA |  |  |  |  |

| `RELAY_STATE_SCHEMA_V1` | const | RELAY_STATE_SCHEMA_V1 |  |  |  |  |

| `defaultRelayStateDir` | const | defaultRelayStateDir |  |  |  |  |

| `checkAuthorityShape` | function | checkAuthorityShape(envelope: RelayEnvelope, allowDo: boolean) |  |  |  |  |

| `checkEnvelopeShape` | function | checkEnvelopeShape(value: unknown) |  |  |  |  |

| `checkExecutionManifest` | function | checkExecutionManifest(envelope: RelayEnvelope, sessionManifest: string) |  |  |  |  |

| `checkExpiry` | function | checkExpiry(envelope: RelayEnvelope, nowMs: number) |  |  |  |  |

| `checkGallWorkBinding` | function | checkGallWorkBinding(envelope: RelayEnvelope, descriptor: unknown) |  |  |  |  |

| `commandIdDigest` | function | commandIdDigest(commandId: string) |  |  |  |  |

| `localAllowDoFromEnv` | function | localAllowDoFromEnv(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `relayIdentityEnv` | function | relayIdentityEnv(descriptor: RelayLeaseDescriptor) |  |  |  |  |

| `relayStatePath` | function | relayStatePath(stateDir: string, worktree: string, epochId: string) |  |  |  |  |

| `AckedCommand` | interface | interface AckedCommand |  |  |  |  |

| `PendingCommand` | interface | interface PendingCommand |  |  |  |  |

| `RelayAckState` | interface | interface RelayAckState |  |  |  |  |

| `RelayEnvelope` | interface | interface RelayEnvelope |  |  |  |  |

| `RelayLeaseDescriptor` | interface | interface RelayLeaseDescriptor |  |  |  |  |

| `RelayWorkerOptions` | interface | interface RelayWorkerOptions |  |  |  |  |

| `acknowledge` | method | acknowledge(commandId: string, receiptRef: string | null = null) |  |  |  |  |

| `acknowledgeDurable` | method | acknowledgeDurable(commandId: string, receiptRef: string | null) |  |  |  |  |

| `admit` | method | admit(raw: unknown) |  |  |  |  |

| `snapshot` | method | snapshot() |  |  |  |  |

| `AckResult` | type | type AckResult |  |  |  |  |

| `AdmissionResult` | type | type AdmissionResult |  |  |  |  |

| `AdmissionStage` | type | type AdmissionStage |  |  |  |  |

| `RelayChannel` | type | type RelayChannel |  |  |  |  |

| `RelayDispatchResult` | type | type RelayDispatchResult |  |  |  |  |

| `RelayRefusal` | type | type RelayRefusal |  |  |  |  |

| `CommandNode` | interface | interface CommandNode |  |  |  |  |

| `Intent` | interface | interface Intent |  |  |  |  |

| `boundedCompanion` | const | boundedCompanion |  |  |  |  |

| `PairedWorld` | interface | interface PairedWorld |  |  |  |  |

| `SurvivalEvidence` | interface | interface SurvivalEvidence |  |  |  |  |

| `QueryContract` | interface | interface QueryContract |  |  |  |  |

| `SourceBinding` | interface | interface SourceBinding |  |  |  |  |

| `Invariant` | interface | interface Invariant |  |  |  |  |

| `Migration` | interface | interface Migration |  |  |  |  |

| `SemanticPart` | interface | interface SemanticPart |  |  |  |  |

| `Authority` | type | type Authority |  |  |  |  |

| `ExactSubject` | interface | interface ExactSubject |  |  |  |  |

| `Standing` | type | type Standing |  |  |  |  |

| `Edge` | interface | interface Edge |  |  |  |  |

| `AttemptBudget` | class | class AttemptBudget |  |  |  |  |

| `WorkOrder` | interface | interface WorkOrder |  |  |  |  |

| `OcelEvent` | interface | interface OcelEvent |  |  |  |  |

| `ExecutionReceipt` | interface | interface ExecutionReceipt |  |  |  |  |

| `Task` | interface | interface Task |  |  |  |  |

| `Event` | interface | interface Event |  |  |  |  |

| `Epoch` | interface | interface Epoch |  |  |  |  |

| `EpochResult` | interface | interface EpochResult |  |  |  |  |

| `admitPortable` | function | admitPortable(value:unknown) |  |  |  |  |

| `Admission` | type | type Admission |  |  |  |  |

| `AttemptBudget` | class | class AttemptBudget |  |  |  |  |

| `consume` | method | consume() |  |  |  |  |

| `remaining` | method | remaining() |  |  |  |  |

| `SA2A_REPLAN_VERSION` | const | SA2A_REPLAN_VERSION |  |  |  |  |

| `isSa2aEnvelope` | const | isSa2aEnvelope |  |  |  |  |

| `Sa2aReplanEnvelope` | interface | interface Sa2aReplanEnvelope |  |  |  |  |

| `RecoveryDecision` | type | type RecoveryDecision |  |  |  |  |

| `FailoverResult` | interface | interface FailoverResult |  |  |  |  |

| `canonicalSubject` | const | canonicalSubject |  |  |  |  |

| `exactEnvelopeIdentity` | const | exactEnvelopeIdentity |  |  |  |  |

| `subjectDigest` | const | subjectDigest |  |  |  |  |

| `toOcelRecoveryEvent` | function | toOcelRecoveryEvent(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `OcelRecoveryEvent` | interface | interface OcelRecoveryEvent |  |  |  |  |

| `providerIsSelectable` | const | providerIsSelectable |  |  |  |  |

| `recordProviderOutcome` | const | recordProviderOutcome |  |  |  |  |

| `ProviderHealthState` | interface | interface ProviderHealthState |  |  |  |  |

| `ProviderHealth` | type | type ProviderHealth |  |  |  |  |

| `CandidateProviderRegistry` | class | class CandidateProviderRegistry |  |  |  |  |

| `CandidateProvider` | interface | interface CandidateProvider |  |  |  |  |

| `excluding` | method | excluding(ids: ReadonlySet<string>) |  |  |  |  |

| `get` | method | get(id: string) |  |  |  |  |

| `register` | method | register(provider: CandidateProvider) |  |  |  |  |

| `applyReceiptFeedback` | function | applyReceiptFeedback(envelope: Sa2aReplanEnvelope, receipt: Sa2aPortableReceipt) |  |  |  |  |

| `Sa2aPortableReceipt` | interface | interface Sa2aPortableReceipt |  |  |  |  |

| `reconcileOutcome` | function | reconcileOutcome(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `recoveryDecision` | function | recoveryDecision(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `withRecovery` | function | withRecovery(envelope: Sa2aReplanEnvelope) |  |  |  |  |

| `assertReplayStable` | function | assertReplayStable(previous:Sa2aReplanEnvelope,next:Sa2aReplanEnvelope) |  |  |  |  |

| `runPortableRecoveryRuntime` | function | runPortableRecoveryRuntime(input: PortableRecoveryRuntimeInput) |  |  |  |  |

| `PortableRecoveryRuntimeInput` | interface | interface PortableRecoveryRuntimeInput |  |  |  |  |

| `PortableRecoveryRuntimeResult` | interface | interface PortableRecoveryRuntimeResult |  |  |  |  |

| `SubjectSnapshot` | type | type SubjectSnapshot |  |  |  |  |

| `ContextItem` | interface | interface ContextItem |  |  |  |  |

| `modelRole` | const | modelRole |  |  |  |  |

| `PortableCapability` | interface | interface PortableCapability |  |  |  |  |

| `capabilitiesFromExtractionMetadata` | function | capabilitiesFromExtractionMetadata(value: unknown) |  |  |  |  |

| `parseRuntimeCapabilities` | function | parseRuntimeCapabilities(value: unknown) |  |  |  |  |

| `RuntimeCapabilities` | interface | interface RuntimeCapabilities |  |  |  |  |

| `RuntimeCliOptionCapability` | interface | interface RuntimeCliOptionCapability |  |  |  |  |

| `RuntimeCliOptionType` | type | type RuntimeCliOptionType |  |  |  |  |

| `mergeDesktopSettings` | function | mergeDesktopSettings(value: unknown, filePath: string, env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerMigrationNeeded` | function | providerMigrationNeeded(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `providerRegistryContainsFamilyKey` | function | providerRegistryContainsFamilyKey(registryConfig: unknown, family: string) |  |  |  |  |

| `resolveRuntimeNode` | function | resolveRuntimeNode(override: string | undefined) |  |  |  |  |

| `SessionModelState` | interface | interface SessionModelState |  |  |  |  |

| `UPDATE_CACHE_TTL_MS` | const | UPDATE_CACHE_TTL_MS |  |  |  |  |

| `UPDATE_CHECK_URL` | const | UPDATE_CHECK_URL |  |  |  |  |

| `refreshUpdateCache` | function | refreshUpdateCache(options: RefreshUpdateCacheOptions) |  |  |  |  |

| `updateCheckDisabled` | function | updateCheckDisabled(env: NodeJS.ProcessEnv = process.env) |  |  |  |  |

| `ReadStartupUpdateOptions` | interface | interface ReadStartupUpdateOptions |  |  |  |  |

| `RefreshUpdateCacheOptions` | interface | interface RefreshUpdateCacheOptions |  |  |  |  |

| `StartupUpdateCheck` | interface | interface StartupUpdateCheck |  |  |  |  |

| `UpdateFetcher` | type | type UpdateFetcher |  |  |  |  |

| `buildZaiAuthorizeUrl` | function | buildZaiAuthorizeUrl(state: string) |  |  |  |  |

| `classifyZaiOAuthInvocation` | function | classifyZaiOAuthInvocation(args: string[]) |  |  |  |  |

| `parseZaiOAuthCallback` | function | parseZaiOAuthCallback(callbackUrl: string, expectedState: string) |  |  |  |  |

| `runZaiOAuthLogin` | function | runZaiOAuthLogin(options: ZaiOAuthLoginOptions) |  |  |  |  |

| `OfficialLoginPayload` | interface | interface OfficialLoginPayload |  |  |  |  |

| `ZaiOAuthCallback` | interface | interface ZaiOAuthCallback |  |  |  |  |

| `ZaiOAuthInvocation` | interface | interface ZaiOAuthInvocation |  |  |  |  |

| `ZaiOAuthLoginOptions` | interface | interface ZaiOAuthLoginOptions |  |  |  |  |

| `zcode` | bin | bin/zcode.js |  |  |  |  |

| `bench:tui-memory` | script | bun --expose-gc scripts/bench-tui-memory.ts |  |  |  |  |

| `bench:tui-stream` | script | bun scripts/bench-tui-stream.ts |  |  |  |  |

| `bench:tui-thinking` | script | bun scripts/bench-tui-thinking.ts |  |  |  |  |

| `build` | script | node node_modules/.bin/tsdown |  |  |  |  |

| `build:launcher` | script | node node_modules/.bin/tsdown --filter launcher |  |  |  |  |

| `build:tui` | script | node node_modules/.bin/tsdown --filter tui |  |  |  |  |

| `check` | script | bun run build && bun scripts/check-runtime.ts |  |  |  |  |

| `check:oauth-callback` | script | bun scripts/smoke-oauth-callback.ts |  |  |  |  |

| `check:tui` | script | bun scripts/smoke-tui.ts && bun scripts/smoke-tui-features.ts && bun scripts/smoke-tui-clear.ts && bun scripts/smoke-tui-session-title.ts && bun scripts/smoke-tui-pressure.ts && bun scripts/smoke-tui-widths.ts && bun scripts/smoke-tui-fullscreen.ts && bun scripts/smoke-tui-fullscreen-switch.ts && bun scripts/smoke-tui-fullscreen-layout.ts |  |  |  |  |

| `check:tui-scenarios` | script | bun run test:tui |  |  |  |  |

| `dev` | script | bun run sync:local && ZCODE_NODE=node bun bin/zcode.ts |  |  |  |  |

| `prepack` | script | bun scripts/check-package.ts --prepack |  |  |  |  |

| `receipts:validate` | script | bun scripts/validate-receipts.ts |  |  |  |  |

| `release:build` | script | bun scripts/build-release.ts |  |  |  |  |

| `release:pack` | script | bun scripts/pack-release.ts |  |  |  |  |

| `release:prepare` | script | bun scripts/build-release.ts --latest |  |  |  |  |

| `sync` | script | bun run build && bun scripts/sync-runtime.ts |  |  |  |  |

| `sync:local` | script | bun run build && bun scripts/sync-runtime.ts --app $HOME/Applications/ZCode.app |  |  |  |  |

| `sync:locked` | script | bun run build && bun scripts/sync-runtime.ts --lock zcode-runtime.lock.json && ZCODE_REQUIRE_TOOLCHAINS=1 ZCODE_REQUIRE_BUNDLE=1 bun test test/sync-runtime-anchor-drift.test.ts test/sync-runtime-loop-gaps.test.ts |  |  |  |  |

| `test` | script | bun run test:unit |  |  |  |  |

| `test:all` | script | bun run test:unit && bun run test:tui && bun run test:runtime && bun run test:node |  |  |  |  |

| `test:capability-snapshot` | script | bun test test/capability-snapshot.test.ts |  |  |  |  |

| `test:fast` | script | bun run test:unit |  |  |  |  |

| `test:live` | script | bun test test/live/ |  |  |  |  |

| `test:node` | script | node --test test/node/*.test.cjs |  |  |  |  |

| `test:runtime` | script | ZCODE_REQUIRE_TOOLCHAINS=1 bun test test/runtime/*.test.ts |  |  |  |  |

| `test:tui` | script | bun run test:tui:component && bun run test:tui:e2e |  |  |  |  |

| `test:tui-scenario` | script | bun scripts/tui-scenario.ts |  |  |  |  |

| `test:tui:component` | script | bun test test/tui/scenario-http.test.ts test/tui/scenario-runtime.test.ts test/tui/scenario-shell.test.ts test/tui/scenario-workspace.test.ts test/tui/terminal-screen.test.ts |  |  |  |  |

| `test:tui:e2e` | script | bun test test/tui/allowlisted-shell.test.ts test/tui/http-mock.test.ts test/tui/model-resume.test.ts test/tui/permission-request-queue.test.ts test/tui/run-scenario.test.ts test/tui/session-rename.test.ts test/tui/terminal-session.test.ts test/tui/write-and-diff.test.ts |  |  |  |  |

| `test:tui:host` | script | bun test test/tui/scenario-mountx.test.ts |  |  |  |  |

| `test:tui:manual` | script | bun scripts/tui-scenario.ts --manual |  |  |  |  |

| `test:unit` | script | ZCODE_REQUIRE_TOOLCHAINS=1 bun test test/*.test.ts |  |  |  |  |

| `typecheck` | script | tsc --noEmit |  |  |  |  |

| `verify:tui-perf` | script | bun scripts/verify-tui-perf.ts |  |  |  |  |

| `version:build` | script | bun scripts/bump-build.ts |  |  |  |  |


<!-- ============================================================= -->
<!-- AGENT-FORBIDDEN-END: nothing below this line may describe     -->
<!-- code behavior.                                                -->
<!-- ============================================================= -->
