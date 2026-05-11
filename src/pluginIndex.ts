import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Indexes <plugin> declarations from all di.xml files.
 * Map key = plugin class FQCN (e.g. Vendor\Module\Plugin\Foo).
 * Value = list of target classes the plugin attaches to.
 */
export class PluginIndex {
    private byPluginClass = new Map<string, string[]>();

    public async build(): Promise<void> {
        this.byPluginClass.clear();
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

    public size(): number { return this.byPluginClass.size; }

    public serialize(): object {
        return { byPluginClass: Array.from(this.byPluginClass.entries()) };
    }

    public deserialize(data: any): void {
        this.byPluginClass = new Map(data.byPluginClass ?? []);
    }

    public getTargets(pluginClass: string): string[] {
        // Normalize: di.xml may use leading backslash
        const norm = pluginClass.replace(/^\\/, '');
        return this.byPluginClass.get(norm) ?? [];
    }

    private scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                this.scanDir(full);
            } else if (entry.isFile() && entry.name === 'di.xml') {
                this.parseDi(full);
            }
        }
    }

    private parseDi(file: string): void {
        let content: string;
        try { content = fs.readFileSync(file, 'utf8'); } catch { return; }

        // Parse: <type name="TargetClass">...<plugin name="x" type="PluginClass" .../>...</type>
        // Also: <virtualType name="..."> can host plugins, but rare for our use.
        const typeRe = /<type\b[^>]*?\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/type>/g;
        let tm: RegExpExecArray | null;
        while ((tm = typeRe.exec(content)) !== null) {
            const target = tm[1].replace(/^\\/, '');
            const inner = tm[2];
            const pluginRe = /<plugin\b[^>]*?\btype=["']([^"']+)["']/g;
            let pm: RegExpExecArray | null;
            while ((pm = pluginRe.exec(inner)) !== null) {
                const pluginClass = pm[1].replace(/^\\/, '');
                const list = this.byPluginClass.get(pluginClass) ?? [];
                if (!list.includes(target)) list.push(target);
                this.byPluginClass.set(pluginClass, list);
            }
        }
    }
}
