import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ClassRef {
    file: string;
    line: number;
    character: number;
    context: string; // short label: 'layout', 'di', 'events', 'webapi', 'crontab', etc.
}

/**
 * Scans Magento config XML files and indexes every FQCN occurrence in attribute values.
 * Used by PHP CodeLens to show "Navigate to usage(s)" above class declarations.
 *
 * Files scanned (by basename):
 *   - any *.xml inside /layout/ or /page_layout/
 *   - di.xml, events.xml, webapi.xml, crontab.xml, acl.xml, system.xml,
 *     extension_attributes.xml, indexer.xml, mview.xml, communication.xml,
 *     widget.xml, email_templates.xml, fieldset.xml
 */
const TARGET_BASENAMES = new Set([
    'di.xml', 'events.xml', 'webapi.xml', 'crontab.xml', 'acl.xml', 'system.xml',
    'extension_attributes.xml', 'indexer.xml', 'mview.xml', 'communication.xml',
    'widget.xml', 'email_templates.xml', 'fieldset.xml', 'view.xml', 'config.xml'
]);

export class XmlClassRefIndex {
    private byClass = new Map<string, ClassRef[]>();

    public size(): number { return this.byClass.size; }

    public serialize(): object {
        return { byClass: Array.from(this.byClass.entries()) };
    }

    public deserialize(data: any): void {
        this.byClass = new Map(data.byClass ?? []);
    }

    public lookup(fqcn: string): ClassRef[] {
        const norm = fqcn.replace(/^\\/, '');
        return this.byClass.get(norm) ?? [];
    }

    public async build(): Promise<void> {
        this.byClass.clear();
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

    private scanDir(dir: string): void {
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                this.scanDir(full);
            } else if (entry.isFile() && entry.name.endsWith('.xml')) {
                const isLayout = full.includes(`${path.sep}layout${path.sep}`)
                    || full.includes(`${path.sep}page_layout${path.sep}`);
                if (isLayout || TARGET_BASENAMES.has(entry.name)) {
                    this.scanFile(full, entry.name);
                }
            }
        }
    }

    private scanFile(file: string, basename: string): void {
        let content: string;
        try { content = fs.readFileSync(file, 'utf8'); } catch { return; }

        const context = this.contextLabel(file, basename);
        // Match FQCN inside attribute values: ="Vendor\Class" or ="Vendor\Sub\Class"
        // Also match inside element content for <argument xsi:type="object">FQCN</argument>
        const re = /(?:["'>])(\\?[A-Z][\w]*(?:\\[A-Z][\w]*)+)(?=["'<\s])/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
            const fqcn = m[1].replace(/^\\/, '');
            const offset = m.index + 1; // skip the opening quote/>
            const before = content.substring(0, offset);
            const line = (before.match(/\n/g) ?? []).length;
            const character = offset - before.lastIndexOf('\n') - 1;
            const ref: ClassRef = { file, line, character, context };
            const list = this.byClass.get(fqcn) ?? [];
            // Avoid duplicate same file+line
            if (!list.some(r => r.file === file && r.line === line)) {
                list.push(ref);
                this.byClass.set(fqcn, list);
            }
        }
    }

    private contextLabel(file: string, basename: string): string {
        if (file.includes(`${path.sep}layout${path.sep}`)) return 'layout';
        if (file.includes(`${path.sep}page_layout${path.sep}`)) return 'page_layout';
        if (basename.endsWith('.xml')) return basename.slice(0, -4);
        return 'xml';
    }
}
