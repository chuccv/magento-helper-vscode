import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * In XML files, Ctrl+Click on a fully-qualified class name resolves to the PHP file.
 * Search order:
 *   1. app/code/{Vendor}/{Module}/...
 *   2. vendor/{vendor}/{package}/[src/]...
 *   3. generated/code/{Vendor}/{Module}/...   (auto-generated factories, proxies, interceptors)
 */
export class XmlClassDefinitionProvider implements vscode.DefinitionProvider {
    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | undefined> {
        const range = document.getWordRangeAtPosition(position, /[\w\\]+/);
        if (!range) return undefined;
        const word = document.getText(range);

        // Heuristic: must look like a FQCN — at least one backslash, starts with uppercase letter
        if (!word.includes('\\')) return undefined;
        const normalized = word.replace(/^\\/, '');
        if (!/^[A-Z]/.test(normalized)) return undefined;

        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of folders) {
            const file = resolveFqcn(normalized, folder.uri.fsPath);
            if (file) {
                return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
            }
        }
        return undefined;
    }
}

function resolveFqcn(fqcn: string, root: string): string | null {
    const parts = fqcn.split('\\');
    if (parts.length < 2) return null;
    const subPath = parts.join('/') + '.php';

    // 1. app/code
    const appCode = path.join(root, 'app', 'code', subPath);
    if (fs.existsSync(appCode)) return appCode;

    // 2. generated/code (factories, proxies, interceptors)
    const generated = path.join(root, 'generated', 'code', subPath);
    if (fs.existsSync(generated)) return generated;

    // 3. vendor — try common layouts
    const vendorRoot = path.join(root, 'vendor');
    if (fs.existsSync(vendorRoot)) {
        const found = scanVendor(vendorRoot, fqcn, subPath);
        if (found) return found;
    }
    return null;
}

const cache = new Map<string, string>();

function scanVendor(vendorRoot: string, fqcn: string, subPath: string): string | null {
    if (cache.has(fqcn)) return cache.get(fqcn)!;
    let vendors: fs.Dirent[];
    try { vendors = fs.readdirSync(vendorRoot, { withFileTypes: true }); } catch { return null; }
    for (const v of vendors) {
        if (!v.isDirectory()) continue;
        const vendorDir = path.join(vendorRoot, v.name);
        let packages: fs.Dirent[];
        try { packages = fs.readdirSync(vendorDir, { withFileTypes: true }); } catch { continue; }
        for (const p of packages) {
            if (!p.isDirectory()) continue;
            // Most Magento modules: vendor/magento/module-foo/Bar/Class.php where namespace strips Magento\Foo
            // Try both: package_root/<full>.php and package_root/src/<full>.php
            // and also stripping common namespace roots: Magento\Catalog -> module-catalog
            const tryDirect = path.join(vendorDir, p.name, subPath);
            if (fs.existsSync(tryDirect)) { cache.set(fqcn, tryDirect); return tryDirect; }
            const trySrc = path.join(vendorDir, p.name, 'src', subPath);
            if (fs.existsSync(trySrc)) { cache.set(fqcn, trySrc); return trySrc; }
            // Magento layout: vendor/magento/module-{name}/{rest after Magento/{Module}/}
            // e.g. Magento\Catalog\Model\Product => vendor/magento/module-catalog/Model/Product.php
            const parts = fqcn.split('\\');
            if (parts.length >= 2) {
                const stripped = parts.slice(2).join('/') + '.php';
                const tryStripped = path.join(vendorDir, p.name, stripped);
                if (fs.existsSync(tryStripped)) { cache.set(fqcn, tryStripped); return tryStripped; }
            }
        }
    }
    return null;
}
