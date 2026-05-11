# Magento Helper

Extension VS Code bổ sung tính năng điều hướng dành riêng cho Magento 2, thay thế cho hỗ trợ XML/PHP thông thường.

## Tính năng

### XML → định nghĩa (Ctrl+Click)
- **`<referenceContainer name="X">` / `<referenceBlock name="X">`** → nhảy tới khai báo `<container>` / `<block>` gốc.
- **Class FQCN trong bất kỳ thuộc tính XML nào** (ví dụ `class="Magento\Catalog\Model\Product"`) → mở file PHP tương ứng trong `app/code/`, `generated/code/`, hoặc `vendor/`.
- **Module asset** (ví dụ `Mageplaza_Core::js/splide.min.js`, `Vendor_Module::hyva/bar.phtml`) → mở file dưới `view/{area}/{web,templates}/`.
- **`method="..."` bên trong `<action>`** → nhảy tới method PHP của block class tương ứng (yêu cầu đã build Index).

### PHP → tham chiếu (CodeLens phía trên class)
- **`N usages (di:3, layout:1, phtml:1)`** — xem toàn bộ file XML cấu hình và file `.phtml` đang tham chiếu tới class đó.
- Pattern phát hiện trong `.phtml`: `use Vendor\Foo\Bar;`, `Vendor\Foo\Bar::class`, `Vendor\Foo\Bar::method(`, `new Vendor\Foo\Bar(`. Hữu ích để truy vết ViewModel được dùng trực tiếp trong template.

### Controller → layout
CodeLens trên controller class hiển thị file layout handle tương ứng (`{frontName}_{controller}_{action}`).

### Plugin → target method
CodeLens phía trên các method `before*` / `after*` / `around*` liên kết tới method gốc trên target class được khai báo trong `di.xml`.

### Tích hợp Magento CLI
Chạy lệnh `bin/magento` trực tiếp từ VS Code.

- **Command Palette**: `M2: Run CLI Command…` (nhập tự do), `M2: Run Favorite CLI Command…` (lệnh gần đây / yêu thích).
- **Lệnh đã đăng ký sẵn** dưới category **`M2 CLI`** — search trong Command Palette: `cache:flush`, `cache:clean`, `indexer:reindex`, `setup:upgrade`, `setup:di:compile`, `setup:static-content:deploy`, `deploy:mode:set`, `maintenance:enable/disable`, `module:enable/disable`, `config:set/show`, `cron:run`, `queue:consumers:*`, `catalog:images:resize`, v.v...
- **Hai chế độ chạy**:
  - **Terminal** (mặc định) — mở integrated terminal để có thể tương tác với prompt.
  - **Silent** — chạy nền, stream output vào Output Channel `Magento CLI`, hiển thị tiến độ ở status bar. Dùng `M2: Run CLI Command (silent, log to output)…`.
- **Tự động phát hiện DDEV**: nếu có `.ddev/config.yaml` ở workspace root, extension dùng `ddev magento` tự động. Có thể override qua `magentoHelper.cli.command`.
- **Status bar**: hiển thị deploy mode hiện tại (`developer` / `production` / `default`) và trạng thái maintenance. Click để refresh.

### URN Catalog Generator
Chạy **`Magento Helper: Generate URN Catalog`** để quét tất cả file `.xsd` và tạo OASIS XML catalog tại `.vscode/magento-urn-catalog-oasis.xml`.  
Catalog được tự động đăng ký vào `.vscode/settings.json` (`xml.catalogs`), giúp extension Red Hat XML resolve các tham chiếu `urn:magento:...` và không còn báo lỗi "schema_reference.4: Failed to read schema document".

Thuần TypeScript — **không** phụ thuộc vào `bin/magento`, DDEV, Docker hay PHP runtime.

---

## Khi nào cần chạy Generate URN Catalog

Chạy **`Magento Helper: Generate URN Catalog`** khi:

- **Lần đầu** mở project trong VS Code (file XML có gạch đỏ trên `urn:magento:...`).
- Sau khi cài hoặc cập nhật module Magento có kèm file `.xsd` (`composer install`, `composer update`).
- Sau khi thêm module tùy chỉnh có định nghĩa `.xsd` riêng.

**Không cần** chạy lại khi chỉ sửa file PHP hoặc XML layout — chỉ cần chạy lại khi file `.xsd` thay đổi.

Sau khi chạy, reload cửa sổ một lần (`Ctrl+Shift+P` → **Developer: Reload Window**) để Red Hat XML extension nạp catalog mới.

---

## Khi nào cần rebuild Index

Index được xây dựng **thủ công** để tránh làm chậm trên codebase Magento lớn.  
Click vào status bar hoặc chạy **`Magento Helper: Rebuild Index`** khi cần.

| Khi nào | Lý do |
|---------|-------|
| Lần đầu mở project | Chưa có index — các tính năng điều hướng chưa hoạt động |
| Status bar hiển thị `⚠ Magento: stale` | Đã lưu file indexable kể từ lần build cuối — Ctrl+Click / CodeLens có thể trả về kết quả cũ |
| Sau `composer install` / `composer update` | Có file PHP/XML mới hoặc thay đổi trong `vendor/` |
| Sau khi pull code thêm/xóa module | Có route, plugin, layout block, hoặc class reference mới |

File nào khi lưu sẽ đánh dấu index là **stale**: layout XML (`layout/*.xml`, `page_layout/*.xml`), `di.xml`, `routes.xml`, `events.xml`, `webapi.xml`, `system.xml`, `acl.xml`, và mọi file `.php` hoặc `.phtml`.

### Tính năng KHÔNG cần Index (hoạt động ngay, không cần rebuild):

- Ctrl+Click vào **class FQCN** → file PHP.
- Ctrl+Click vào **module asset** (`Module_Name::path/to/file`) → file template hoặc static asset.

### Tính năng CẦN Index đã được build:

- Ctrl+Click vào tên `referenceContainer` / `referenceBlock` → định nghĩa gốc.
- Ctrl+Click vào `method="..."` bên trong `<action>` → method PHP.
- CodeLens: controller → layout handle, plugin → target method, class → XML usages.

| Status bar | Ý nghĩa |
|------------|---------|
| `○ Magento: not indexed` | Chưa có index — tính năng chưa hoạt động |
| `↻ Magento: indexing` | Đang quét workspace |
| `✓ Magento: indexed` | Index đã cập nhật |
| `⚠ Magento: stale` | Đã lưu file indexable — nên rebuild |
| `✗ Magento: failed` | Build bị lỗi — hover để xem thông báo |

---

## Cấu hình

```jsonc
{
  "magentoHelper.searchPaths": [
    "app/code",
    "app/design",
    "vendor/magento",
    "vendor/hyva-themes",
    "generated/code"
  ],

  // Tích hợp Magento CLI
  "magentoHelper.cli.command": "bin/magento",            // hoặc "ddev magento", "docker compose exec php bin/magento"
  "magentoHelper.cli.autoDetectDdev": true,              // tự chuyển sang `ddev magento` khi có .ddev/config.yaml
  "magentoHelper.cli.cwd": "",                           // rỗng = workspace root
  "magentoHelper.cli.defaultRunMode": "terminal",        // "terminal" | "silent"
  "magentoHelper.cli.statusBar.enabled": true,
  "magentoHelper.cli.statusBar.refreshIntervalSec": 60
}
```

## Lệnh

Index & catalog:
- `Magento Helper: Rebuild Index`
- `Magento Helper: Generate URN Catalog`

Magento CLI:
- `M2: Run CLI Command…` / `M2: Run Favorite CLI Command…`
- `M2: Run CLI Command (silent, log to output)…` / `M2: Run Favorite CLI Command (silent)…`
- `M2: Open CLI Log`
- `M2: Refresh CLI Catalog` / `M2: Refresh CLI Status`
- Thêm 50+ lệnh đã đăng ký sẵn dưới category `M2 CLI` (ví dụ `M2 CLI: cache:flush`, `M2 CLI: setup:upgrade`, `M2 CLI: indexer:reindex`).

---

## Cài đặt

### Cách A — Cài từ file `.vsix` có sẵn (khuyến nghị)

1. Tải file `magento-helper-x.y.z.vsix` mới nhất từ
   [GitHub Releases](https://github.com/chuccv/magento-helper-vscode/releases)
   (hoặc lấy từ team).
2. Cài đặt:
   ```bash
   code --install-extension magento-helper-x.y.z.vsix
   ```
3. Reload VS Code (`Ctrl+Shift+P` → **Developer: Reload Window**).
4. Click vào status bar `○ Magento: not indexed` để build index.

### Cách B — Build từ source (dành cho contributor / thay đổi chưa release)

Yêu cầu Node.js 18+.

```bash
git clone git@github.com:chuccv/magento-helper-vscode.git
cd magento-helper-vscode
npm install
npx tsc -p ./
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension magento-helper-*.vsix
```

Sau khi sửa source:

```bash
npx tsc -p ./
npx --yes @vscode/vsce package --allow-missing-repository --skip-license
code --install-extension magento-helper-*.vsix --force
```

Sau đó reload cửa sổ VS Code.

### Cách C — Chạy unpackaged (debug trực tiếp)

Dành cho phát triển tích cực với hot reload:

```bash
git clone git@github.com:chuccv/magento-helper-vscode.git
cd magento-helper-vscode
npm install
code .
# Nhấn F5 trong VS Code để mở cửa sổ "Extension Development Host"
# Sửa src/*.ts, cửa sổ host tự reload khi lưu (sau khi tsc chạy lại)
```

---

## Cập nhật

Extension chưa có trên Marketplace nên không tự cập nhật. Để nâng cấp:

1. Tải `.vsix` mới từ Releases (hoặc build lại từ source).
2. `code --install-extension magento-helper-<phiên-bản-mới>.vsix --force`
3. Reload cửa sổ.

## Gỡ cài đặt

```bash
code --uninstall-extension chuccv.magento-helper
```

## Giấy phép

MIT
