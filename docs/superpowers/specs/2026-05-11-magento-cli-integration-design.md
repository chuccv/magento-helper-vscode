# Magento CLI Integration — Design

Date: 2026-05-11
Owner: chuccv
Status: Approved (design phase)

## Goal

Add Magento 2 CLI integration to the existing VS Code extension so the user can:

1. Discover and run any `bin/magento` command from inside VS Code (Command Palette + Quick Pick), including custom commands provided by installed modules.
2. Configure how the CLI is invoked (raw `bin/magento`, `ddev magento`, `docker compose exec ...`, etc.) with auto-detection for DDEV.
3. See live Magento environment status (deploy mode, maintenance mode) on the status bar.

This is **purely additive**. It does not modify the existing index/provider code paths.

## Non-goals

- No GUI form for every command's arguments — only required arguments are prompted via `InputBox`.
- No tree view in the activity bar (deferred).
- No background reindex/cache health monitoring (only deploy mode + maintenance mode in status bar).
- No multi-root workspace support beyond the first workspace folder.

## User-facing surface

### Commands (registered in `package.json`)

| Command id | Title | Purpose |
|---|---|---|
| `magentoHelper.cli.run` | `Magento: Run CLI Command…` | Open Quick Pick listing every catalog command, grouped by namespace. |
| `magentoHelper.cli.runFavorite` | `Magento: Run Favorite CLI Command…` | Quick Pick limited to a hardcoded favorites list. |
| `magentoHelper.cli.refreshCatalog` | `Magento: Refresh CLI Catalog` | Run `bin/magento list --format=json`, merge result into the cached catalog. |
| `magentoHelper.cli.refreshStatus` | `Magento: Refresh CLI Status` | Re-read deploy mode + maintenance status immediately. |

Favorites (hardcoded, not configurable in v1):
`cache:flush`, `cache:clean`, `setup:upgrade`, `setup:di:compile`, `setup:static-content:deploy`, `indexer:reindex`, `maintenance:enable`, `maintenance:disable`.

### Settings

| Key | Type | Default | Notes |
|---|---|---|---|
| `magentoHelper.cli.command` | `string` | `"bin/magento"` | Full executor prefix. Examples: `"ddev magento"`, `"docker compose exec php bin/magento"`. The command name is appended as a separate argv token. |
| `magentoHelper.cli.autoDetectDdev` | `boolean` | `true` | If `cli.command` is the default and a DDEV project is detected (see below), the executor uses `"ddev magento"` instead. |
| `magentoHelper.cli.cwd` | `string` | `""` | Working directory for the executor. Empty means workspace root. |
| `magentoHelper.cli.statusBar.enabled` | `boolean` | `true` | If `false`, no status bar item is created and no background polling runs. |
| `magentoHelper.cli.statusBar.refreshIntervalSec` | `number` | `60` | `0` disables periodic refresh (status only refreshes on activation, on `refreshStatus`, and after a tracked command finishes). |

### Status bar

A single left-aligned `StatusBarItem`. Format:

```
M2: <mode> | maint:<on|off>
```

Examples: `M2: dev | maint:off`, `M2: production | maint:on`. While loading: `M2: …`. On error: `M2: ?` with the error in tooltip.

Click action: opens a Quick Pick with quick actions:

- `Refresh status`
- `Toggle maintenance mode` (calls `maintenance:enable` or `maintenance:disable`)
- `Switch deploy mode → developer`
- `Switch deploy mode → production`
- `Open: Run CLI Command…`

### Quick Pick UX (`magentoHelper.cli.run`)

- Items grouped visually by namespace prefix (`cache:*`, `indexer:*`, `setup:*`, …) using Quick Pick separators.
- Each item: `label = command name`, `description = short summary`, `detail = full description` (truncated).
- Filter typing is native VS Code Quick Pick fuzzy match.
- After selection, if the command has required arguments in catalog metadata, prompt one `InputBox` per required argument (label = arg name, placeholder = arg description). Optional arguments are not prompted; user can append flags freely once the command lands in the terminal — actually no: see "Argument handling" below.

### Argument handling

Two layers:

1. **Required positional args** declared in catalog metadata → prompted via `InputBox` before the command is sent to the terminal.
2. **Free-form extras** → after building the base command line (executor + cmd + collected required args), the line is **typed into the integrated terminal but NOT auto-executed** (i.e. `terminal.sendText(line, /*addNewLine*/ false)`). The user can append flags / options and press Enter themselves. This avoids reimplementing every Magento flag.

Exception: status-bar quick actions (`maintenance:enable`, `maintenance:disable`, `deploy:mode:set developer|production`) auto-execute (`addNewLine = true`) since they have no extra args worth editing.

## Architecture

All new code lives under `src/cli/`. The existing `src/extension.ts` `activate()` function gains four wiring lines and nothing else changes elsewhere.

```
src/cli/
  cliExecutor.ts       # Resolve executor prefix + run via terminal OR child_process
  cliCatalog.ts        # Hardcoded core command list + merge from `list --format=json`
  cliCommandPicker.ts  # Quick Pick UI + InputBox arg prompts
  cliStatusBar.ts      # Status bar item, polling, click-menu
  cliTypes.ts          # Shared types: CliCommand, CliArgument, CliExecutor
```

### `cliTypes.ts`

```ts
export interface CliArgument {
  name: string;
  description?: string;
  required: boolean;
}

export interface CliCommand {
  name: string;            // e.g. "cache:flush"
  namespace: string;       // e.g. "cache" (derived if absent)
  description: string;
  args: CliArgument[];     // required-only entries are prompted
  source: 'core' | 'discovered';
}
```

### `cliExecutor.ts`

Responsibilities:

- `resolvePrefix(): string[]` — read `magentoHelper.cli.command`, split by spaces into argv tokens. If default value and `autoDetectDdev` is true and `<workspaceRoot>/.ddev/config.yaml` exists → return `['ddev','magento']`.
- `resolveCwd(): string` — read `cli.cwd`; default to first workspace folder. If neither, throw `MagentoCliError('No workspace folder')`.
- `runInTerminal(commandName: string, args: string[], opts?: { execute: boolean }): void`
  - Reuses a singleton terminal named `Magento CLI` (creates if missing or disposed).
  - Builds the line: `<prefix joined with spaces> <commandName> <args quoted>`.
  - `terminal.show(true); terminal.sendText(line, opts?.execute ?? false);`
- `runHeadless(commandName: string, args: string[]): Promise<{ stdout: string; stderr: string; code: number }>`
  - Uses `child_process.spawn` with the resolved prefix's first token as `command`, the remaining as args, plus `[commandName, ...args]`. `cwd = resolveCwd()`. 30s timeout.
  - Used only by `cliStatusBar` and `refreshCatalog`.

Quoting rule: shell-escape any arg containing whitespace or shell metacharacters with double quotes and backslash-escape internal `"` and `\`.

### `cliCatalog.ts`

- `CORE_COMMANDS: CliCommand[]` — hardcoded list of ~150 stable core commands. Initial seed can be small (the favorites + 30-50 commonly used ones); the rest fill in on first `refreshCatalog`. The hardcoded list ensures the picker is useful before any CLI call succeeds.
- `loadCatalog(context): CliCommand[]` — read merged catalog from `context.globalState` keyed by workspace root path; fall back to `CORE_COMMANDS`.
- `refreshCatalog(context, executor): Promise<CliCommand[]>` — run `executor.runHeadless('list', ['--format=json'])`, parse JSON, normalize to `CliCommand[]`, merge with `CORE_COMMANDS` (discovered overrides core for matching names), persist to `globalState`. Show progress notification.
- Discovered command args: Magento's `list --format=json` includes `definition.arguments` — map each to `CliArgument` with `required` from the JSON.

### `cliCommandPicker.ts`

- `showRunPicker(context, executor)` — full catalog Quick Pick.
- `showFavoritePicker(context, executor)` — filter catalog by favorites list.
- After selection: collect required args via sequential `InputBox`. ESC at any prompt cancels. Then call `executor.runInTerminal(name, args, { execute: false })`.

### `cliStatusBar.ts`

- Single class `CliStatusBar` with `start(context)` and `dispose()`.
- On start (and every `refreshIntervalSec`): in parallel run `runHeadless('deploy:mode:show', [])` and `runHeadless('maintenance:status', [])`. Parse:
  - deploy mode regex: `/Current application mode:\s*(\S+)/i`
  - maintenance regex: `/Status:\s*maintenance mode is (active|not active)/i`
- Update label and tooltip. On parse failure or non-zero exit, set `M2: ?` and put stderr in tooltip.
- Click handler runs Quick Pick of quick actions described above.
- Disposed in `deactivate()` chain (added to `context.subscriptions`).

### Wiring in `src/extension.ts`

Inside `activate()`, after existing setup:

```ts
const executor = new CliExecutor();
const statusBar = new CliStatusBar(executor);
statusBar.start(context);
context.subscriptions.push(statusBar);

context.subscriptions.push(
  vscode.commands.registerCommand('magentoHelper.cli.run',
    () => showRunPicker(context, executor)),
  vscode.commands.registerCommand('magentoHelper.cli.runFavorite',
    () => showFavoritePicker(context, executor)),
  vscode.commands.registerCommand('magentoHelper.cli.refreshCatalog',
    () => refreshCatalog(context, executor)),
  vscode.commands.registerCommand('magentoHelper.cli.refreshStatus',
    () => statusBar.refresh()),
);
```

`package.json` `activationEvents` already includes `onLanguage:xml` and `onLanguage:php`. Add `onCommand:magentoHelper.cli.*` so the CLI features activate even in a workspace where no XML/PHP file is opened yet. The status bar still requires activation; we accept that it appears only after first activation event fires.

## Error handling

- No workspace folder open → commands show `vscode.window.showWarningMessage('Open a Magento project folder first.')` and return.
- Executor `runHeadless` non-zero exit or timeout → `cliStatusBar` shows `M2: ?`; `refreshCatalog` shows error message with truncated stderr.
- Terminal-mode commands always succeed at the extension layer — failures are visible to the user in the terminal output.
- Auto-detect DDEV failure (e.g. `.ddev/config.yaml` exists but `ddev` binary missing) is the user's responsibility; we do not validate the binary.

## Testing strategy

The repo currently has no test infrastructure. We will not add a test framework as part of this change. Manual verification checklist (run by the author before merging):

1. Open a non-DDEV Magento project, default settings → status bar shows `M2: <mode> | maint:<state>`.
2. Open a DDEV project (presence of `.ddev/config.yaml`) with default settings → executor uses `ddev magento` (verify by running `magentoHelper.cli.refreshCatalog` and inspecting terminal command).
3. Set `magentoHelper.cli.command = "ddev magento"` explicitly → same behavior, no auto-detect needed.
4. `Magento: Run CLI Command…` lists ≥30 commands before any refresh; after `Refresh CLI Catalog`, list grows to include any custom module command (verify with one known custom module).
5. Pick `module:enable` → InputBox prompts for `module` arg → command appears in terminal but is NOT auto-executed.
6. Pick `cache:flush` from favorites → command lands in terminal, user presses Enter manually.
7. Click status bar → quick actions menu → `Toggle maintenance mode` flips status within next refresh cycle.
8. Set `statusBar.enabled = false` → no status bar item, no background polling (verified by no `bin/magento` processes during 5-minute idle).

## Out of scope (future work)

- Activity-bar tree view of CLI commands and live status.
- Persistent per-user favorites configurable via settings.
- Argument GUI (form) for complex commands.
- Multi-root workspace support.
- Notifications when indexes become invalid.
