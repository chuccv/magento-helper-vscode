# Magento Helper

VS Code extension that adds Magento 2-aware navigation features missing from generic XML/PHP support.

## Features

### XML → definition
- **`<referenceContainer name="X">` / `<referenceBlock name="X">`** → Ctrl+Click goes to the original `<container>` / `<block>` definition.
- **Class FQCN in any XML attribute** → Ctrl+Click resolves the class file under `app/code/`, `generated/code/` (factories, proxies, interceptors), or `vendor/`.

### PHP → references (CodeLens above class)
- **`N XML usages (di:3, layout:1, events:1)`** — peek every XML file referencing the class.

### Controller → layout
CodeLens on controller class shows the matching layout handle file(s) (`{frontName}_{controller}_{action}`).

### Plugin → target method
CodeLens above `before*` / `after*` / `around*` methods links to the corresponding method on the target class declared in `di.xml`.

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

## Status bar

`✓ Magento: 142L / 8R / 67P / 1284X` — layout names · route modules · plugin classes · class refs.
Click to rebuild the index manually.

## Commands

- `Magento Helper: Rebuild Index`

## License

MIT
