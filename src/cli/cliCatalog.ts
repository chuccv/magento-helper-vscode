import * as vscode from 'vscode';
import { CliCommand, CliArgument } from './cliTypes';
import { CliExecutor } from './cliExecutor';
import { CORE_COMMANDS, FAVORITE_NAMES } from './cliCoreCommands';

export { CORE_COMMANDS, FAVORITE_NAMES };

const CATALOG_KEY_PREFIX = 'magentoHelper.cli.catalog:';

function ns(name: string): string {
    const i = name.indexOf(':');
    return i >= 0 ? name.substring(0, i) : '_';
}

function workspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders;
    const root = folders && folders.length > 0 ? folders[0].uri.fsPath : '_';
    return CATALOG_KEY_PREFIX + root;
}

export function loadCatalog(context: vscode.ExtensionContext): CliCommand[] {
    const stored = context.globalState.get<CliCommand[]>(workspaceKey());
    if (stored && Array.isArray(stored) && stored.length > 0) return stored;
    return CORE_COMMANDS;
}

function mergeCommands(core: CliCommand[], discovered: CliCommand[]): CliCommand[] {
    const map = new Map<string, CliCommand>();
    for (const c of core) map.set(c.name, c);
    for (const d of discovered) map.set(d.name, d); // discovered overrides
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

interface SymfonyListJson {
    commands?: Array<{
        name: string;
        description?: string;
        definition?: {
            arguments?: Record<string, {
                name: string;
                description?: string;
                is_required?: boolean;
            }>;
        };
    }>;
}

function parseListJson(stdout: string): CliCommand[] {
    const start = stdout.indexOf('{');
    if (start < 0) return [];
    const json = stdout.substring(start);
    let data: SymfonyListJson;
    try {
        data = JSON.parse(json);
    } catch {
        return [];
    }
    if (!data.commands) return [];
    const out: CliCommand[] = [];
    for (const c of data.commands) {
        if (!c.name) continue;
        const args: CliArgument[] = [];
        const argDefs = c.definition?.arguments ?? {};
        for (const key of Object.keys(argDefs)) {
            if (key === 'command') continue;
            const a = argDefs[key];
            args.push({
                name: a.name ?? key,
                description: a.description,
                required: !!a.is_required,
            });
        }
        out.push({
            name: c.name,
            namespace: ns(c.name),
            description: c.description ?? '',
            args,
            source: 'discovered',
        });
    }
    return out;
}

export async function refreshCatalog(
    context: vscode.ExtensionContext,
    executor: CliExecutor
): Promise<CliCommand[]> {
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Magento: refreshing CLI catalog…' },
        async () => {
            try {
                const res = await executor.runHeadless('list', ['--format=json']);
                if (res.code !== 0) {
                    vscode.window.showErrorMessage(
                        `Magento CLI list failed (exit ${res.code}): ${res.stderr.slice(0, 200)}`
                    );
                    return loadCatalog(context);
                }
                const discovered = parseListJson(res.stdout);
                if (discovered.length === 0) {
                    vscode.window.showWarningMessage('Magento CLI list returned no commands.');
                    return loadCatalog(context);
                }
                const merged = mergeCommands(CORE_COMMANDS, discovered);
                await context.globalState.update(workspaceKey(), merged);
                vscode.window.showInformationMessage(
                    `Magento CLI catalog refreshed: ${merged.length} commands.`
                );
                return merged;
            } catch (e) {
                vscode.window.showErrorMessage(`Magento CLI refresh error: ${(e as Error).message}`);
                return loadCatalog(context);
            }
        }
    );
}
