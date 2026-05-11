import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ConfigPathLocation {
    file: string;
    line: number;
}

/**
 * Indexes system.xml config paths: "section/group/field" → file + line.
 * Supports goto for ifconfig="..." attributes in layout XML.
 */
export class ConfigPathIndex {
    private byPath = new Map<string, ConfigPathLocation>();

    public size(): number { return this.byPath.size; }

    public lookup(configPath: string): ConfigPathLocation | undefined {
        return this.byPath.get(configPath);
    }

    public async build(): Promise<void> {
        this.byPath.clear();
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
        return { byPath: Array.from(this.byPath.entries()) };
    }

    public deserialize(data: any): void {
        this.byPath = new Map(data.byPath ?? []);
    }

    private scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                this.scanDir(full);
            } else if (entry.isFile() && entry.name === 'system.xml') {
                this.parseSysXml(full);
            }
        }
    }

    private parseSysXml(file: string): void {
        let content: string;
        try { content = fs.readFileSync(file, 'utf8'); } catch { return; }

        const lines = content.split('\n');
        let section = '';
        let group = '';

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (/<\/section\b/.test(line)) { section = ''; group = ''; continue; }
            if (/<\/group\b/.test(line)) { group = ''; continue; }

            const sectionM = /<section\b[^>]*\bid=["']([^"']+)["']/.exec(line);
            if (sectionM) { section = sectionM[1]; group = ''; continue; }

            const groupM = /<group\b[^>]*\bid=["']([^"']+)["']/.exec(line);
            if (groupM) { group = groupM[1]; continue; }

            if (!section || !group) continue;

            const fieldM = /<field\b[^>]*\bid=["']([^"']+)["']/.exec(line);
            if (fieldM) {
                const configPath = `${section}/${group}/${fieldM[1]}`;
                if (!this.byPath.has(configPath)) {
                    this.byPath.set(configPath, { file, line: i });
                }
            }
        }
    }
}
