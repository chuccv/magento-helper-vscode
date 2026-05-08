import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RoutesIndex } from './routesIndex';

/**
 * For a Controller class file at .../app/code/Vendor/Module/Controller/[Path/]Action.php,
 * compute layout handle name(s) and locate matching layout XMLs.
 *
 *   Handle = {frontName}_{controller}_{action}
 *
 * controller = lowercased subpath under Controller/, joined by '_' (typically a single segment)
 * action = lowercased class name
 */
export class ControllerLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly routes: RoutesIndex) {}

    public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        const fsPath = document.uri.fsPath;
        const controllerInfo = parseControllerPath(fsPath);
        if (!controllerInfo) return [];

        const text = document.getText();
        // Find class declaration line
        const classMatch = /^(\s*)(?:abstract\s+|final\s+)?class\s+(\w+)/m.exec(text);
        if (!classMatch) return [];
        const offset = classMatch.index;
        const before = text.substring(0, offset);
        const line = (before.match(/\n/g) ?? []).length;

        const routes = this.routes.getByModule(controllerInfo.moduleName)
            .filter(r => r.area === controllerInfo.area);
        if (routes.length === 0) return [];

        const handles: string[] = [];
        for (const r of routes) {
            const handle = `${r.frontName}_${controllerInfo.controllerSegment}_${controllerInfo.actionSegment}`.toLowerCase();
            handles.push(handle);
        }

        const layoutFiles = await findLayoutFiles(handles);
        if (layoutFiles.length === 0) {
            return [
                new vscode.CodeLens(
                    new vscode.Range(line, 0, line, 0),
                    {
                        title: `$(file-code) No layout XML found for handle: ${handles.join(', ')}`,
                        command: ''
                    }
                )
            ];
        }

        const lens = new vscode.CodeLens(
            new vscode.Range(line, 0, line, 0),
            {
                title: `$(file-code) Open layout (${layoutFiles.length}) — ${handles[0]}`,
                command: 'magentoHelper.openLayoutFiles',
                arguments: [layoutFiles]
            }
        );
        return [lens];
    }
}

interface ControllerInfo {
    moduleName: string; // Vendor_Module
    area: 'frontend' | 'adminhtml';
    controllerSegment: string;
    actionSegment: string;
}

function parseControllerPath(fsPath: string): ControllerInfo | null {
    // Match either app/code/Vendor/Module/Controller/... or vendor/.../Controller/...
    // Capture: vendor=Vendor, module=Module, rest after Controller/
    const re = /[\\/](?:app[\\/]code|vendor[\\/][^\\/]+[\\/][^\\/]+)[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]Controller[\\/](.+)\.php$/;
    const m = re.exec(fsPath.replace(/\\/g, '/'));
    if (!m) {
        // Simpler match for app/code
        const re2 = /[\\/]app[\\/]code[\\/]([^\\/]+)[\\/]([^\\/]+)[\\/]Controller[\\/](.+)\.php$/;
        const m2 = re2.exec(fsPath.replace(/\\/g, '/'));
        if (!m2) return null;
        return buildInfo(m2[1], m2[2], m2[3]);
    }
    return buildInfo(m[1], m[2], m[3]);
}

function buildInfo(vendor: string, module: string, rest: string): ControllerInfo {
    // rest = e.g. "Adminhtml/Product/Edit" or "Product/View"
    const parts = rest.split('/');
    let area: 'frontend' | 'adminhtml' = 'frontend';
    if (parts[0] === 'Adminhtml') {
        area = 'adminhtml';
        parts.shift();
    }
    const action = parts.pop() ?? 'index';
    const controller = parts.join('_') || 'index';
    return {
        moduleName: `${vendor}_${module}`,
        area,
        controllerSegment: controller.toLowerCase(),
        actionSegment: action.toLowerCase()
    };
}

async function findLayoutFiles(handles: string[]): Promise<string[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const config = vscode.workspace.getConfiguration('magentoHelper');
    const searchPaths: string[] = config.get('searchPaths') ?? [];
    const found: string[] = [];
    for (const folder of folders) {
        for (const sub of searchPaths) {
            const root = path.join(folder.uri.fsPath, sub);
            if (!fs.existsSync(root)) continue;
            walk(root, handles, found);
        }
    }
    return found;
}

function walk(dir: string, handles: string[], found: string[]): void {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git') continue;
            walk(full, handles, found);
        } else if (entry.isFile() && entry.name.endsWith('.xml')) {
            const base = entry.name.slice(0, -4);
            if (handles.includes(base) && (full.includes(`${path.sep}layout${path.sep}`))) {
                found.push(full);
            }
        }
    }
}
