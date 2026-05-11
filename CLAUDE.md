# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VS Code extension providing Go-to-Definition and CodeLens for Magento 2 codebases (XML layouts, controllers, DI plugins, XML→PHP class refs).

## Tech Stack

- TypeScript (target compiled to `out/` via `tsc`)
- VS Code Extension API (`^1.75.0`)
- No runtime dependencies; only `@types/node`, `@types/vscode`, `typescript`

## Commands

- Compile: `npm run compile`
- Watch: `npm run watch`
- Package VSIX: `npx vsce package`
- Run/debug: open in VS Code, press F5 (Extension Development Host)

There are no tests or linter configured.

## Architecture

Entry: `src/extension.ts` wires everything in `activate()`.

The extension is built around **manual indexing** — indexes are NOT auto-rebuilt on file change. On save of an indexable file, the status bar flips to "stale"; user must click it (runs `magentoHelper.rebuildIndex`) to rebuild.

Four independent indexes built in parallel from files under `magentoHelper.searchPaths`:

- `layoutIndex.ts` — XML layout/page_layout files → referenceContainer/Block targets (used by `layoutDefinitionProvider.ts`)
- `routesIndex.ts` — `routes.xml` → controller class mapping (used by `controllerLens.ts`)
- `pluginIndex.ts` — `di.xml` plugins → target class/method (used by `pluginLens.ts`)
- `xmlClassRefIndex.ts` — XML references to PHP classes (used by `phpUsageLens.ts` and `xmlClassDefinitionProvider.ts`)

Providers register against `xml`/`php` language IDs. Commands exposed: `rebuildIndex`, `openLayoutFiles`, `gotoLocations`, `generateUrnCatalog` (pure TS URN catalog generator in `urnCatalog.ts`, no Magento CLI dependency).

## Gotchas

- Activation: `onLanguage:xml` / `onLanguage:php` only — opening a non-XML/PHP file in a Magento workspace will not activate the extension.
- `isIndexable()` in `extension.ts` is the source of truth for which file saves flip the index to stale. Update it when adding new indexed file types.
- `searchPaths` is workspace-relative; defaults include `app/code`, `app/design`, `vendor/magento`, `vendor/hyva-themes`, `generated/code`.
