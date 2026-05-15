import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class ModuleIndex {
    private byName = new Map<string, string>(); // moduleName → registration.php path

    public size(): number { return this.byName.size; }

    public lookup(moduleName: string): string | undefined {
        return this.byName.get(moduleName);
    }

    public async build(): Promise<void> {
        this.byName.clear();
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

    public serialize(): object {
        return { byName: Array.from(this.byName.entries()) };
    }

    public deserialize(data: any): void {
        this.byName = new Map(data.byName ?? []);
    }

    private scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                this.scanDir(full);
            } else if (entry.isFile() && entry.name === 'registration.php') {
                this.parseRegistration(full);
            }
        }
    }

    private parseRegistration(file: string): void {
        let content: string;
        try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
        // ComponentRegistrar::register(ComponentRegistrar::MODULE, 'Vendor_Module', __DIR__)
        const m = /ComponentRegistrar::MODULE\s*,\s*['"]([A-Z][a-zA-Z0-9]*_[A-Z][a-zA-Z0-9]*)['"]/.exec(content);
        if (m && !this.byName.has(m[1])) {
            this.byName.set(m[1], file);
        }
    }
}
