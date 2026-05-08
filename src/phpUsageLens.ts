import * as vscode from 'vscode';
import { XmlClassRefIndex } from './xmlClassRefIndex';

/**
 * CodeLens above PHP class declaration showing how many XML files reference
 * the class. Click to peek/navigate the list.
 */
export class PhpUsageLensProvider implements vscode.CodeLensProvider {
    constructor(private readonly index: XmlClassRefIndex) {}

    public provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const text = document.getText();
        const ns = /^\s*namespace\s+([\w\\]+);/m.exec(text);
        const cls = /^(\s*)(?:abstract\s+|final\s+)?(class|interface|trait)\s+(\w+)/m.exec(text);
        if (!cls) return [];
        const fqcn = ns ? `${ns[1]}\\${cls[3]}` : cls[3];

        const refs = this.index.lookup(fqcn);
        if (refs.length === 0) return [];

        const offset = cls.index;
        const before = text.substring(0, offset);
        const line = (before.match(/\n/g) ?? []).length;

        // Group by context for label
        const byContext = new Map<string, number>();
        for (const r of refs) byContext.set(r.context, (byContext.get(r.context) ?? 0) + 1);
        const summary = [...byContext.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}:${v}`)
            .join(', ');

        const locations = refs.map(r => new vscode.Location(
            vscode.Uri.file(r.file),
            new vscode.Position(r.line, r.character)
        ));

        return [new vscode.CodeLens(
            new vscode.Range(line, 0, line, 0),
            {
                title: `$(references) ${refs.length} XML usage${refs.length > 1 ? 's' : ''} (${summary})`,
                command: 'magentoHelper.gotoLocations',
                arguments: [locations]
            }
        )];
    }
}
