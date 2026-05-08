# Magento Helper

VS Code extension that adds Magento 2-aware navigation features missing from generic XML/PHP support.

## Features

### XML → definition (Ctrl+Click)
- **`<referenceContainer name="X">` / `<referenceBlock name="X">`** → goes to the original `<container>` / `<block>` definition.
- **Class FQCN in any XML attribute** → resolves the class file under `app/code/`, `generated/code/` (factories, proxies, interceptors), or `vendor/`.

### PHP → references (CodeLens above class)
- **`N XML usages (di:3, layout:1, events:1)`** — peek every XML file referencing the class.

### Controller → layout
CodeLens on controller class shows the matching layout handle file(s) (`{frontName}_{controller}_{action}`).

### Plugin → target method
CodeLens above `before*` / `after*` / `around*` methods links to the corresponding method on the target class declared in `di.xml`.

### URN Catalog Generator
Run **`Magento Helper: Generate URN Catalog`** to scan all `.xsd` files and build an OASIS XML catalog at `.vscode/magento-urn-catalog-oasis.xml`.
The catalog is auto-registered in `.vscode/settings.json` under `xml.catalogs`, so the Red Hat XML extension can resolve `urn:magento:...` schema references and stop showing "schema_reference.4: Failed to read schema document".

Pure TypeScript implementation — does **not** depend on `bin/magento` / DDEV / Docker / PHP runtime.

## Indexing

Indexing is **manual** to avoid slowdowns on large Magento codebases.
Click the status bar item or run **`Magento Helper: Rebuild Index`** when you need it.

| Status bar | Meaning |
|------------|---------|
| `○ Magento: not indexed` | No index built yet — features inactive |
| `↻ Magento: indexing` | Scanning workspace |
| `✓ Magento: indexed` | Index up to date |
| `⚠ Magento: stale` | Indexable file saved since last build — rebuild recommended |
| `✗ Magento: failed` | Last build errored — hover for message |

## Configuration

```jsonc
{
  "magentoHelper.searchPaths": [
    "app/code",
    "app/design",
    "vendor/magento",
    "vendor/hyva-themes",
    "generated/code"
  ]
}
```

## Commands

- `Magento Helper: Rebuild Index`
- `Magento Helper: Generate URN Catalog`

## Installation

### Option A — Install from a pre-built `.vsix` (recommended for users)

1. Download the latest `magento-helper-x.y.z.vsix` from
   [GitHub Releases](https://github.com/chuccv/magento-helper-vscode/releases)
   (or get it from the team).
2. Install:
   ```bash
   code --install-extension magento-helper-x.y.z.vsix
   ```
3. Reload VS Code (`Ctrl+Shift+P` → **Developer: Reload Window**).
4. Open the status bar item `○ Magento: not indexed` to build the index.

### Option B — Build from source (for contributors / latest unreleased changes)

Requires Node.js 18+.

```bash
git clone git@github.com:chuccv/magento-helper-vscode.git
cd magento-helper-vscode
npm install
npx tsc -p ./
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension magento-helper-*.vsix
```

After source changes:

```bash
npx tsc -p ./
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension magento-helper-*.vsix --force
```

Then reload VS Code window.

### Option C — Run unpackaged (live debug)

For active development with hot reload:

```bash
git clone git@github.com:chuccv/magento-helper-vscode.git
cd magento-helper-vscode
npm install
code .
# Press F5 in VS Code to launch a new "Extension Development Host" window
# Edit src/*.ts, the host window auto-reloads on save (after re-running tsc)
```

## Updating

The extension does not auto-update (not on the Marketplace yet). To upgrade:

1. Pull the latest `.vsix` from Releases (or rebuild from source).
2. `code --install-extension magento-helper-<new-version>.vsix --force`
3. Reload the window.

## Uninstall

```bash
code --uninstall-extension chuccv.magento-helper
```

## License

MIT
