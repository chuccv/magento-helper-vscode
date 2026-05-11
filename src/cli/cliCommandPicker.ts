import * as vscode from 'vscode';
import { CliCommand } from './cliTypes';
import { CliExecutor } from './cliExecutor';
import { loadCatalog, FAVORITE_NAMES } from './cliCatalog';

interface CommandQuickPickItem extends vscode.QuickPickItem {
    cmd?: CliCommand;
}

function buildItems(commands: CliCommand[]): CommandQuickPickItem[] {
    const sorted = [...commands].sort((a, b) => {
        if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace);
        return a.name.localeCompare(b.name);
    });
    const items: CommandQuickPickItem[] = [];
    let currentNs = '';
    for (const c of sorted) {
        if (c.namespace !== currentNs) {
            currentNs = c.namespace;
            items.push({
                label: currentNs === '_' ? 'global' : currentNs,
                kind: vscode.QuickPickItemKind.Separator,
            });
        }
        items.push({
            label: c.name,
            description: c.source === 'discovered' ? '' : '(core)',
            detail: c.description,
            cmd: c,
        });
    }
    return items;
}

async function promptArgs(cmd: CliCommand): Promise<string[] | undefined> {
    const collected: string[] = [];
    for (const arg of cmd.args) {
        if (!arg.required) continue;
        const value = await vscode.window.showInputBox({
            title: `${cmd.name} — ${arg.name}`,
            prompt: arg.description ?? `Value for ${arg.name}`,
            ignoreFocusOut: true,
        });
        if (value === undefined) return undefined; // cancelled
        collected.push(value);
    }
    return collected;
}

type RunMode = 'terminal' | 'silent';

function defaultRunMode(): RunMode {
    const v = vscode.workspace
        .getConfiguration('magentoHelper.cli')
        .get<string>('defaultRunMode', 'terminal');
    return v === 'silent' ? 'silent' : 'terminal';
}

async function executeCommand(
    executor: CliExecutor,
    cmd: CliCommand,
    args: string[],
    mode: RunMode
): Promise<void> {
    if (mode === 'silent') {
        await executor.runSilent(cmd.name, args);
    } else {
        executor.runInTerminal(cmd.name, args, { execute: false });
    }
}

async function pickAndRun(
    items: CommandQuickPickItem[],
    placeholder: string,
    executor: CliExecutor,
    mode: RunMode
): Promise<void> {
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: placeholder,
        matchOnDescription: true,
        matchOnDetail: true,
    });
    if (!pick || !pick.cmd) return;
    const args = await promptArgs(pick.cmd);
    if (args === undefined) return;
    await executeCommand(executor, pick.cmd, args, mode);
}

export async function showRunPicker(
    context: vscode.ExtensionContext,
    executor: CliExecutor,
    mode: RunMode = defaultRunMode()
): Promise<void> {
    const catalog = loadCatalog(context);
    const label = mode === 'silent' ? '(silent) Run Magento CLI command…' : 'Run Magento CLI command…';
    await pickAndRun(buildItems(catalog), label, executor, mode);
}

export async function runCommandByName(
    context: vscode.ExtensionContext,
    executor: CliExecutor,
    name: string,
    mode: RunMode = defaultRunMode()
): Promise<void> {
    const catalog = loadCatalog(context);
    const cmd = catalog.find(c => c.name === name);
    if (!cmd) {
        vscode.window.showWarningMessage(`Magento CLI: unknown command "${name}".`);
        return;
    }
    const args = await promptArgs(cmd);
    if (args === undefined) return;
    await executeCommand(executor, cmd, args, mode);
}

export async function showFavoritePicker(
    context: vscode.ExtensionContext,
    executor: CliExecutor,
    mode: RunMode = defaultRunMode()
): Promise<void> {
    const catalog = loadCatalog(context);
    const set = new Set(FAVORITE_NAMES);
    const favorites = catalog.filter(c => set.has(c.name));
    if (favorites.length === 0) {
        vscode.window.showWarningMessage('No favorite Magento commands available.');
        return;
    }
    const label = mode === 'silent' ? '(silent) Run favorite Magento CLI command…' : 'Run favorite Magento CLI command…';
    await pickAndRun(buildItems(favorites), label, executor, mode);
}
