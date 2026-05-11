import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Scans the workspace for .xsd files and writes an OASIS XML Catalog mapping
 * Magento URN -> local file path, so Red Hat XML can resolve schema references.
 *
 * URN conventions (mirrored from Magento\Framework\Config\Dom\UrnResolver):
 *   - vendor/magento/framework/{rest}.xsd            -> urn:magento:framework:{rest}.xsd
 *   - vendor/magento/framework-{name}/{rest}.xsd     -> urn:magento:framework-{name}:{rest}.xsd
 *   - vendor/magento/module-{name}/{rest}.xsd        -> urn:magento:module:Magento_{Name}:{rest}.xsd
 *   - app/code/{Vendor}/{Module}/{rest}.xsd          -> urn:magento:module:{Vendor}_{Module}:{rest}.xsd
 */

interface CatalogEntry {
    urn: string;
    path: string;
}

export async function generateUrnCatalog(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
        vscode.window.showErrorMessage('Magento Helper: no workspace folder open');
        return;
    }
    const root = folders[0].uri.fsPath;

    const total = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Generating URN catalog…' },
        async (progress) => {
            const entries: CatalogEntry[] = [];
            scan(path.join(root, 'vendor', 'magento'), root, entries);
            scan(path.join(root, 'app', 'code'), root, entries);
            scan(path.join(root, 'vendor', 'hyva-themes'), root, entries);

            // De-dup by URN (last wins)
            const map = new Map<string, string>();
            for (const e of entries) map.set(e.urn, e.path);

            progress.report({ message: `${map.size} schemas, writing file…` });

            const out = buildOasis(map);
            const catalogDir = path.join(root, '.vscode');
            if (!fs.existsSync(catalogDir)) fs.mkdirSync(catalogDir, { recursive: true });
            const catalogPath = path.join(catalogDir, 'magento-urn-catalog-oasis.xml');
            fs.writeFileSync(catalogPath, out);

            await ensureSettingsReference(root, '.vscode/magento-urn-catalog-oasis.xml');
            return map.size;
        }
    );

    // Show result OUTSIDE withProgress so the progress notification dismisses immediately.
    const choice = await vscode.window.showInformationMessage(
        `URN catalog generated: ${total} entries. Reload window to apply.`,
        'Reload Window'
    );
    if (choice === 'Reload Window') {
        vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}

function scan(dir: string, root: string, entries: CatalogEntry[]): void {
    if (!fs.existsSync(dir)) return;
    let items: fs.Dirent[];
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            if (item.name === 'node_modules' || item.name === '.git') continue;
            scan(full, root, entries);
        } else if (item.isFile() && item.name.endsWith('.xsd')) {
            const urn = deriveUrn(full, root);
            if (urn) entries.push({ urn, path: full });
        }
    }
}

function deriveUrn(file: string, root: string): string | null {
    const rel = path.relative(root, file).replace(/\\/g, '/');

    // vendor/magento/framework/{rest}.xsd -> urn:magento:framework:{rest}.xsd
    let m = /^vendor\/magento\/framework\/(.+\.xsd)$/.exec(rel);
    if (m) return `urn:magento:framework:${m[1]}`;

    // vendor/magento/framework-{name}/{rest}.xsd -> urn:magento:framework-{name}:{rest}.xsd
    m = /^vendor\/magento\/framework-([^/]+)\/(.+\.xsd)$/.exec(rel);
    if (m) return `urn:magento:framework-${m[1]}:${m[2]}`;

    // vendor/magento/module-{name}/{rest}.xsd -> urn:magento:module:Magento_{PascalName}:{rest}.xsd
    m = /^vendor\/magento\/module-([^/]+)\/(.+\.xsd)$/.exec(rel);
    if (m) {
        const moduleName = m[1].split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
        return `urn:magento:module:Magento_${moduleName}:${m[2]}`;
    }

    // app/code/{Vendor}/{Module}/{rest}.xsd -> urn:magento:module:{Vendor}_{Module}:{rest}.xsd
    m = /^app\/code\/([^/]+)\/([^/]+)\/(.+\.xsd)$/.exec(rel);
    if (m) return `urn:magento:module:${m[1]}_${m[2]}:${m[3]}`;

    // vendor/hyva-themes/{package}/{rest}.xsd: best-effort skip (no canonical URN)
    return null;
}

function buildOasis(map: Map<string, string>): string {
    const lines: string[] = [];
    lines.push('<?xml version="1.0"?>');
    lines.push('<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog" prefer="system">');
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [urn, file] of sorted) {
        lines.push(`  <system systemId="${escapeXml(urn)}" uri="file://${file}"/>`);
    }
    lines.push('</catalog>');
    lines.push('');
    return lines.join('\n');
}

function escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, c => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
    } as Record<string, string>)[c]!);
}

// Minimal JSONC parser: strips // and /* */ comments and trailing commas,
// while preserving content inside string literals (so URLs like https:// don't break).
function parseJsonc(raw: string): Record<string, unknown> {
    let out = '';
    let i = 0;
    let inStr = false;
    while (i < raw.length) {
        const c = raw[i];
        if (inStr) {
            out += c;
            if (c === '\\' && i + 1 < raw.length) { out += raw[i + 1]; i += 2; continue; }
            if (c === '"') inStr = false;
            i++;
            continue;
        }
        if (c === '"') { inStr = true; out += c; i++; continue; }
        if (c === '/' && raw[i + 1] === '/') {
            while (i < raw.length && raw[i] !== '\n') i++;
            continue;
        }
        if (c === '/' && raw[i + 1] === '*') {
            i += 2;
            while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
            i += 2;
            continue;
        }
        out += c;
        i++;
    }
    // Remove trailing commas before } or ]
    out = out.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(out);
}

async function ensureSettingsReference(root: string, relativeCatalog: string): Promise<void> {
    // Prefer VS Code's configuration API — it preserves comments/formatting in JSONC.
    try {
        const xmlConfig = vscode.workspace.getConfiguration('xml');
        const current = xmlConfig.get<string[]>('catalogs') ?? [];
        if (!current.includes(relativeCatalog)) {
            const next = [...current, relativeCatalog];
            await xmlConfig.update('catalogs', next, vscode.ConfigurationTarget.Workspace);
        }
        return;
    } catch {
        // Fall through to file-based fallback
    }

    const settingsPath = path.join(root, '.vscode', 'settings.json');
    let json: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
        try {
            json = parseJsonc(fs.readFileSync(settingsPath, 'utf8'));
        } catch {
            vscode.window.showWarningMessage(
                'Magento Helper: .vscode/settings.json could not be parsed; ' +
                `add "xml.catalogs": ["${relativeCatalog}"] manually.`
            );
            return;
        }
    }
    const catalogs = (json['xml.catalogs'] as string[] | undefined) ?? [];
    if (!catalogs.includes(relativeCatalog)) {
        catalogs.push(relativeCatalog);
        json['xml.catalogs'] = catalogs;
        if (!fs.existsSync(path.dirname(settingsPath))) {
            fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(json, null, 2) + '\n');
    }
}
