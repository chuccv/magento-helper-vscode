import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { PluginIndex } from './pluginIndex';

/**
 * Detects plugin classes (registered in any di.xml) and adds CodeLens above
 * before/after/around* methods linking to the corresponding target method.
 */
export class PluginLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly index: PluginIndex) {}

    public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const text = document.getText();
        const fqcn = parseClassFqcn(text);
        if (!fqcn) return [];

        const targets = this.index.getTargets(fqcn);
        if (targets.length === 0) return [];

        const lenses: vscode.CodeLens[] = [];
        const methodRe = /^\s*(?:public|protected|private)?\s*function\s+(before|after|around)([A-Z]\w*)\s*\(/gm;
        let m: RegExpExecArray | null;
        while ((m = methodRe.exec(text)) !== null) {
            const prefix = m[1];
            const methodCamel = m[2];
            const targetMethod = methodCamel.charAt(0).toLowerCase() + methodCamel.slice(1);
            const offset = m.index;
            const before = text.substring(0, offset);
            const lineNum = (before.match(/\n/g) ?? []).length;

            const targetLocations = this.findTargetMethod(targets, targetMethod);
            const title = targetLocations.length > 0
                ? `$(arrow-right) ${prefix} → ${targets[0].split('\\').pop()}::${targetMethod}() (${targetLocations.length})`
                : `$(warning) ${prefix} → ${targetMethod}() not found in: ${targets.join(', ')}`;

            const args = targetLocations.length > 0 ? [targetLocations] : [];
            const command = targetLocations.length > 0 ? 'magentoHelper.gotoLocations' : '';

            lenses.push(new vscode.CodeLens(
                new vscode.Range(lineNum, 0, lineNum, 0),
                { title, command, arguments: args }
            ));
        }
        return lenses;
    }

    private findTargetMethod(targets: string[], methodName: string): vscode.Location[] {
        const locations: vscode.Location[] = [];
        const folders = vscode.workspace.workspaceFolders ?? [];
        for (const target of targets) {
            const filePath = resolveFqcnToFile(target, folders);
            if (!filePath) continue;
            try {
                const content = fs.readFileSync(filePath, 'utf8');
                const re = new RegExp(`function\\s+${methodName}\\s*\\(`, 'g');
                const m = re.exec(content);
                if (m) {
                    const before = content.substring(0, m.index);
                    const line = (before.match(/\n/g) ?? []).length;
                    locations.push(new vscode.Location(
                        vscode.Uri.file(filePath),
                        new vscode.Position(line, before.length - before.lastIndexOf('\n') - 1)
                    ));
                } else {
                    // Method may be inherited — still link to the class file
                    locations.push(new vscode.Location(vscode.Uri.file(filePath), new vscode.Position(0, 0)));
                }
            } catch {}
        }
        return locations;
    }
}

function parseClassFqcn(text: string): string | null {
    const ns = /^\s*namespace\s+([\w\\]+);/m.exec(text);
    const cls = /^(?:abstract\s+|final\s+)?class\s+(\w+)/m.exec(text);
    if (!cls) return null;
    return ns ? `${ns[1]}\\${cls[1]}` : cls[1];
}

function resolveFqcnToFile(fqcn: string, folders: readonly vscode.WorkspaceFolder[]): string | null {
    // Try app/code first, then vendor
    const subPath = fqcn.replace(/\\/g, '/') + '.php';
    // app/code/Vendor/Module/Path/Class.php
    for (const folder of folders) {
        const a = path.join(folder.uri.fsPath, 'app', 'code', subPath);
        if (fs.existsSync(a)) return a;
        // vendor: most modules use PSR-4 src/ layout: vendor/{vendor}/{package}/Path/Class.php
        // We try a heuristic: walk vendor/* and check.
        const vendorRoot = path.join(folder.uri.fsPath, 'vendor');
        if (!fs.existsSync(vendorRoot)) continue;
        const found = findInVendor(vendorRoot, fqcn);
        if (found) return found;
    }
    return null;
}

const vendorCache = new Map<string, string>();

function findInVendor(vendorRoot: string, fqcn: string): string | null {
    if (vendorCache.has(fqcn)) return vendorCache.get(fqcn)!;
    // Strategy: try common module layouts
    // 1) magento/module-foo/Bar/Class.php  (Magento\Foo\Bar\Class)
    // 2) magento/framework/Bar/Class.php   (Magento\Framework\Bar\Class)
    // 3) hyva-themes/magento2-theme-module/src/Bar/Class.php
    const parts = fqcn.split('\\'); // e.g. ['Magento','Catalog','Model','Product']
    const className = parts.pop()!;
    const tail = parts.join('/') + '/' + className + '.php';

    const candidates = [
        path.join(vendorRoot, 'magento', 'framework', tail.replace(/^Magento\/Framework\//, '')),
        path.join(vendorRoot, 'magento', 'module-' + (parts[1] ?? '').toLowerCase(), tail.replace(new RegExp(`^${parts[0]}/${parts[1] ?? ''}/`), '')),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) { vendorCache.set(fqcn, c); return c; }
    }
    // Fallback: shallow search
    try {
        const vendors = fs.readdirSync(vendorRoot, { withFileTypes: true });
        for (const v of vendors) {
            if (!v.isDirectory()) continue;
            const vendorDir = path.join(vendorRoot, v.name);
            const packages = fs.readdirSync(vendorDir, { withFileTypes: true });
            for (const p of packages) {
                if (!p.isDirectory()) continue;
                const tryA = path.join(vendorDir, p.name, tail);
                if (fs.existsSync(tryA)) { vendorCache.set(fqcn, tryA); return tryA; }
                const tryB = path.join(vendorDir, p.name, 'src', tail);
                if (fs.existsSync(tryB)) { vendorCache.set(fqcn, tryB); return tryB; }
            }
        }
    } catch {}
    return null;
}
