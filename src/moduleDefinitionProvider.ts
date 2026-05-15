import * as vscode from 'vscode';
import { ModuleIndex } from './moduleIndex';

const MODULE_NAME_RE = /[A-Z][a-zA-Z0-9]*_[A-Z][a-zA-Z0-9]*/;

export class ModuleDefinitionProvider implements vscode.DefinitionProvider {
    constructor(private readonly index: ModuleIndex) {}

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        if (document.languageId === 'php') {
            return this.resolvePhp(document, position);
        }
        if (document.languageId === 'xml') {
            return this.resolveXml(document, position);
        }
        return undefined;
    }

    private resolvePhp(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        const range = document.getWordRangeAtPosition(position, MODULE_NAME_RE);
        if (!range) return undefined;
        return this.locationFor(document.getText(range));
    }

    private resolveXml(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.Definition | undefined {
        const line = document.lineAt(position.line).text;
        const col = position.character;

        // Match name="Vendor_Module" inside a <module ... tag
        const nameRe = /\bname=["']([A-Z][a-zA-Z0-9]*_[A-Z][a-zA-Z0-9]*)["']/g;
        let m: RegExpExecArray | null;
        while ((m = nameRe.exec(line)) !== null) {
            const valStart = line.indexOf(m[1], m.index);
            const valEnd = valStart + m[1].length;
            if (col < valStart || col > valEnd) continue;

            // Verify enclosing tag is <module
            const before = line.substring(0, valStart);
            if (!/<module\b[^<]*$/.test(before)) continue;

            return this.locationFor(m[1]);
        }
        return undefined;
    }

    private locationFor(moduleName: string): vscode.Definition | undefined {
        const file = this.index.lookup(moduleName);
        if (!file) return undefined;
        return new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0));
    }
}
