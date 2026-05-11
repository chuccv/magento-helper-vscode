import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LayoutIndex } from './layoutIndex';

/**
 * In XML files, Ctrl+Click on:
 *   - FQCN class name  → PHP file
 *   - Module_Name::path  → template / static asset file
 *   - method="methodName" inside <action>  → PHP method definition
 */
export class XmlClassDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private layoutIndex: LayoutIndex) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | undefined> {
        // 1. method="..." inside <action> → goto PHP method
        // Only trigger when cursor is strictly inside the value of a method="<value>" attribute.
        const lineText = document.lineAt(position.line).text;
        const col = position.character;
        const methodAttrRe = /\bmethod=["']([^"']*)["']/g;
        let ma: RegExpExecArray | null;
        while ((ma = methodAttrRe.exec(lineText)) !== null) {
            // ma.index = start of `method=`, value starts after `method="` (7 or 8 chars)
            const valueStart = ma.index + 8; // after method="
            const valueEnd = valueStart + ma[1].length;
            if (col >= valueStart && col <= valueEnd) {
                const methodName = ma[1];
                const loc = await this.resolveMethod(document, position, methodName);
                if (loc) return loc;
                break;
            }
        }

        // 2. Module_Name::path references (templates and static assets)
        const tplRange = document.getWordRangeAtPosition(position, /[\w]+_[\w]+::[\w./\-]+\.[a-zA-Z0-9]+/);
        if (tplRange) {
            const text = document.getText(tplRange);
            const folders = vscode.workspace.workspaceFolders ?? [];
            for (const folder of folders) {
                const file = resolveModuleAsset(text, folder.uri.fsPath);
                if (file) return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
            }
            return undefined;
        }

        // 3. FQCN class resolution
        const range = document.getWordRangeAtPosition(position, /[\w\\]+/);
        if (!range) return undefined;
        const word2 = document.getText(range);
        if (!word2.includes('\\')) return undefined;
        const normalized = word2.replace(/^\\/, '');
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

    // Find the nearest ancestor block/referenceBlock, resolve its class, then find the method in PHP
    private async resolveMethod(
        document: vscode.TextDocument,
        position: vscode.Position,
        methodName: string
    ): Promise<vscode.Location | undefined> {
        const textBefore = document.getText(new vscode.Range(new vscode.Position(0, 0), position));

        // Scan ALL block/referenceBlock tags in textBefore and take the last one (nearest ancestor).
        const tagRe = /<(block|referenceBlock)\b([^>]*?)(?:\/?>)/g;
        let lastTag: { tag: string; attrs: string } | null = null;
        let m: RegExpExecArray | null;
        while ((m = tagRe.exec(textBefore)) !== null) {
            lastTag = { tag: m[1], attrs: m[2] };
        }
        if (!lastTag) return undefined;

        const nameM = /\bname=["']([^"']+)["']/.exec(lastTag.attrs);
        if (!nameM) return undefined;
        const blockName = nameM[1];

        let fqcn: string | null = null;

        // For <block>, prefer the inline class= attribute
        if (lastTag.tag === 'block') {
            const classM = /\bclass=["']([^"']+)["']/.exec(lastTag.attrs);
            if (classM) fqcn = classM[1];
        }

        // Fall back to index lookup (needed for <referenceBlock> and <block> without inline class)
        if (!fqcn) {
            fqcn = this.layoutIndex.lookupClass(blockName);
        }

        if (!fqcn) return undefined;
        fqcn = fqcn.replace(/^\\/, '');

        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const folder of folders) {
            const phpFile = resolveFqcn(fqcn, folder.uri.fsPath);
            if (!phpFile) continue;
            const phpLine = findMethodLine(phpFile, methodName);
            return new vscode.Location(vscode.Uri.file(phpFile), new vscode.Position(phpLine ?? 0, 0));
        }
        return undefined;
    }
}

function findMethodLine(file: string, method: string): number | null {
    try {
        const lines = fs.readFileSync(file, 'utf8').split('\n');
        const re = new RegExp(`\\bfunction\\s+${method}\\b`);
        for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) return i;
        }
    } catch { /* ignore */ }
    return null;
}

function resolveModuleAsset(ref: string, root: string): string | null {
    // ref: "Vendor_Module::path/to/file.ext"
    const m = /^([\w]+)_([\w]+)::(.+)$/.exec(ref);
    if (!m) return null;
    const vendor = m[1];
    const module = m[2];
    const sub = m[3];
    const isTemplate = /\.(phtml|html)$/.test(sub);
    // templates live under view/{area}/templates/; everything else (js/css/less/svg/png/...) under view/{area}/web/
    const subDirs = isTemplate ? ['templates'] : ['web'];
    const areas = ['frontend', 'base', 'adminhtml'];
    const vendorLower = vendor.toLowerCase();
    const moduleKebab = module.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    const candidates: string[] = [];
    for (const area of areas) {
        for (const sd of subDirs) {
            candidates.push(path.join(root, 'app', 'code', vendor, module, 'view', area, sd, sub));
            candidates.push(path.join(root, 'vendor', vendorLower, `module-${moduleKebab}`, 'view', area, sd, sub));
        }
    }
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }

    // Theme overrides: app/design/{scope}/{vendor}/{theme}/{Vendor_Module}/{templates|web}/{sub}
    const designRoot = path.join(root, 'app', 'design');
    if (fs.existsSync(designRoot)) {
        for (const scope of ['frontend', 'adminhtml']) {
            const scopeDir = path.join(designRoot, scope);
            if (!fs.existsSync(scopeDir)) continue;
            try {
                for (const v of fs.readdirSync(scopeDir, { withFileTypes: true })) {
                    if (!v.isDirectory()) continue;
                    const vDir = path.join(scopeDir, v.name);
                    for (const t of fs.readdirSync(vDir, { withFileTypes: true })) {
                        if (!t.isDirectory()) continue;
                        for (const sd of subDirs) {
                            const p = path.join(vDir, t.name, `${vendor}_${module}`, sd, sub);
                            if (fs.existsSync(p)) return p;
                        }
                    }
                }
            } catch { /* ignore */ }
        }
    }
    return null;
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
