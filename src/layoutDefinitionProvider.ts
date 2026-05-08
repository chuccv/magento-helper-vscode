import * as vscode from 'vscode';
import { LayoutIndex } from './layoutIndex';

const REF_TAGS = new Set(['referenceContainer', 'referenceBlock']);

export class LayoutDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly index: LayoutIndex) {}

    public async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Definition | undefined> {
        const line = document.lineAt(position.line).text;

        // Find name="..." attribute the cursor is inside
        const attrRe = /\bname=["']([^"']+)["']/g;
        let m: RegExpExecArray | null;
        let nameMatch: { name: string; start: number; end: number } | null = null;
        while ((m = attrRe.exec(line)) !== null) {
            const valStart = m.index + m[0].indexOf(m[1]);
            const valEnd = valStart + m[1].length;
            if (position.character >= valStart && position.character <= valEnd) {
                nameMatch = { name: m[1], start: valStart, end: valEnd };
                break;
            }
        }
        if (!nameMatch) return undefined;

        // Verify the enclosing tag is a reference* tag (only those need navigation)
        // Look back from the name attribute to find the opening tag name
        const beforeAttr = line.substring(0, nameMatch.start);
        const tagMatch = beforeAttr.match(/<(\w+)\b[^<]*$/);
        if (!tagMatch) return undefined;
        const tag = tagMatch[1];
        if (!REF_TAGS.has(tag)) {
            // Allow navigation also from <move element="X"> and after/before attributes — future
            return undefined;
        }

        const locations = this.index.lookup(nameMatch.name)
            // Skip the current line itself (don't goto self)
            .filter(loc => !(loc.file === document.uri.fsPath && loc.line === position.line));

        if (locations.length === 0) return undefined;

        return locations.map(loc =>
            new vscode.Location(
                vscode.Uri.file(loc.file),
                new vscode.Position(loc.line, loc.character)
            )
        );
    }
}
