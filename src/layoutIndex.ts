import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface NameLocation {
    file: string;
    line: number;
    character: number;
    tag: string; // 'container' | 'referenceContainer' | 'block' | 'referenceBlock'
}

/**
 * Indexes container/block definitions across all layout XML files.
 * Map key = name attribute. Multiple definitions per name allowed.
 */
export class LayoutIndex {
    private byName = new Map<string, NameLocation[]>();
    private fileNames = new Map<string, string[]>(); // file -> names declared (for incremental update)
    private building = false;

    public async build(force = false): Promise<void> {
        if (this.building && !force) return;
        this.building = true;
        try {
            this.byName.clear();
            this.fileNames.clear();

            const folders = vscode.workspace.workspaceFolders ?? [];
            const config = vscode.workspace.getConfiguration('magentoHelper');
            const searchPaths: string[] = config.get('searchPaths') ?? [];

            for (const folder of folders) {
                for (const sub of searchPaths) {
                    const root = path.join(folder.uri.fsPath, sub);
                    if (!fs.existsSync(root)) continue;
                    await this.scanDir(root);
                }
            }
        } finally {
            this.building = false;
        }
    }

    public async refreshFile(uri: vscode.Uri): Promise<void> {
        this.removeFile(uri);
        await this.scanFile(uri.fsPath);
    }

    public removeFile(uri: vscode.Uri): void {
        const names = this.fileNames.get(uri.fsPath);
        if (!names) return;
        for (const name of names) {
            const list = this.byName.get(name);
            if (!list) continue;
            const filtered = list.filter(loc => loc.file !== uri.fsPath);
            if (filtered.length === 0) this.byName.delete(name);
            else this.byName.set(name, filtered);
        }
        this.fileNames.delete(uri.fsPath);
    }

    public lookup(name: string): NameLocation[] {
        return this.byName.get(name) ?? [];
    }

    public size(): number { return this.byName.size; }

    private async scanDir(dir: string): Promise<void> {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                // Only descend into typical Magento layout-bearing folders for speed
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                await this.scanDir(full);
            } else if (entry.isFile() && entry.name.endsWith('.xml')) {
                // Only layout/page_layout XMLs contain container/block defs
                if (full.includes(`${path.sep}layout${path.sep}`) || full.includes(`${path.sep}page_layout${path.sep}`)) {
                    await this.scanFile(full);
                }
            }
        }
    }

    private async scanFile(file: string): Promise<void> {
        let content: string;
        try {
            content = fs.readFileSync(file, 'utf8');
        } catch {
            return;
        }
        // Match: <container name="X">, <block ... name="X" ...>, <referenceContainer name="X">, <referenceBlock name="X">
        const re = /<(container|block|referenceContainer|referenceBlock)\b[^>]*?\bname=["']([^"']+)["']/g;
        const declaredHere: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
            const tag = m[1];
            const name = m[2];
            const offset = m.index;
            const before = content.substring(0, offset);
            const line = (before.match(/\n/g) ?? []).length;
            const character = offset - before.lastIndexOf('\n') - 1;
            const loc: NameLocation = { file, line, character, tag };
            const list = this.byName.get(name) ?? [];
            list.push(loc);
            this.byName.set(name, list);
            declaredHere.push(name);
        }
        if (declaredHere.length > 0) this.fileNames.set(file, declaredHere);
    }
}
