import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Maps module name -> { area, frontName }
 * Parsed from etc/{frontend,adminhtml}/routes.xml
 */
export interface RouteInfo {
    area: 'frontend' | 'adminhtml';
    frontName: string;
    moduleName: string; // Vendor_Module
}

export class RoutesIndex {
    private byModule = new Map<string, RouteInfo[]>();

    public async build(): Promise<void> {
        this.byModule.clear();
        const folders = vscode.workspace.workspaceFolders ?? [];
        const config = vscode.workspace.getConfiguration('magentoHelper');
        const searchPaths: string[] = config.get('searchPaths') ?? [];
        for (const folder of folders) {
            for (const sub of searchPaths) {
                const root = path.join(folder.uri.fsPath, sub);
                if (!fs.existsSync(root)) continue;
                this.scanDir(root);
            }
        }
    }

    public getByModule(moduleName: string): RouteInfo[] {
        return this.byModule.get(moduleName) ?? [];
    }

    public size(): number { return this.byModule.size; }

    private scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                this.scanDir(full);
            } else if (entry.isFile() && entry.name === 'routes.xml') {
                this.parseRoutes(full);
            }
        }
    }

    private parseRoutes(file: string): void {
        let content: string;
        try { content = fs.readFileSync(file, 'utf8'); } catch { return; }

        // Detect area from path: .../etc/frontend/routes.xml or .../etc/adminhtml/routes.xml
        const area: 'frontend' | 'adminhtml' = file.includes(`${path.sep}adminhtml${path.sep}`) ? 'adminhtml' : 'frontend';

        // Parse: <route id="..." frontName="..."><module name="Vendor_Module"/></route>
        const routeRe = /<route\b[^>]*?\bfrontName=["']([^"']+)["'][^>]*>([\s\S]*?)<\/route>/g;
        let m: RegExpExecArray | null;
        while ((m = routeRe.exec(content)) !== null) {
            const frontName = m[1];
            const inner = m[2];
            const modRe = /<module\b[^>]*?\bname=["']([^"']+)["']/g;
            let mm: RegExpExecArray | null;
            while ((mm = modRe.exec(inner)) !== null) {
                const moduleName = mm[1];
                const info: RouteInfo = { area, frontName, moduleName };
                const list = this.byModule.get(moduleName) ?? [];
                list.push(info);
                this.byModule.set(moduleName, list);
            }
        }
    }
}
