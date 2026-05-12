import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const TERMINAL_NAME = 'Tailwind';
const SETTING_KEY = 'tailwind.themePath';

export type TailwindMode = 'build' | 'watch';

function workspaceRoot(): string | undefined {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
}

// Find theme tailwind directories: app/design/frontend/<vendor>/<theme>/web/tailwind
function findTailwindDirs(root: string): string[] {
    const base = path.join(root, 'app', 'design', 'frontend');
    if (!fs.existsSync(base)) return [];
    const results: string[] = [];
    let vendors: string[] = [];
    try {
        vendors = fs.readdirSync(base);
    } catch {
        return [];
    }
    for (const vendor of vendors) {
        const vendorPath = path.join(base, vendor);
        let themes: string[] = [];
        try {
            if (!fs.statSync(vendorPath).isDirectory()) continue;
            themes = fs.readdirSync(vendorPath);
        } catch {
            continue;
        }
        for (const theme of themes) {
            const tailwindDir = path.join(vendorPath, theme, 'web', 'tailwind');
            try {
                if (fs.statSync(tailwindDir).isDirectory()) {
                    results.push(tailwindDir);
                }
            } catch {
                // not a tailwind theme
            }
        }
    }
    return results;
}

function getOrCreateTerminal(cwd: string): vscode.Terminal {
    const existing = vscode.window.terminals.find(t => t.name === TERMINAL_NAME);
    if (existing) return existing;
    return vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
}

// Resolve themePath (workspace-relative or absolute) to the tailwind dir.
function resolveConfiguredPath(root: string, themePath: string): string | undefined {
    const themeAbs = path.isAbsolute(themePath) ? themePath : path.join(root, themePath);
    // Accept either a theme root (…/<vendor>/<theme>) or the tailwind dir itself.
    const candidates = [
        themeAbs,
        path.join(themeAbs, 'web', 'tailwind'),
    ];
    for (const c of candidates) {
        try {
            if (fs.statSync(c).isDirectory() && fs.existsSync(path.join(c, 'package.json'))) {
                return c;
            }
        } catch {
            // try next
        }
    }
    return undefined;
}

async function pickAndPersist(root: string): Promise<string | undefined> {
    const dirs = findTailwindDirs(root);
    if (dirs.length === 0) {
        vscode.window.showWarningMessage(
            'No Tailwind theme found under app/design/frontend/*/*/web/tailwind.'
        );
        return undefined;
    }

    let chosen: string;
    if (dirs.length === 1) {
        chosen = dirs[0];
    } else {
        const items = dirs.map(d => ({
            label: path.relative(root, d),
            description: d,
            dir: d,
        }));
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select Tailwind theme (will be remembered in settings)',
        });
        if (!pick) return undefined;
        chosen = pick.dir;
    }

    // Save the theme root (parent of web/tailwind) as workspace setting.
    const themeRoot = path.dirname(path.dirname(chosen)); // strip /web/tailwind
    const relative = path.relative(root, themeRoot);
    try {
        await vscode.workspace
            .getConfiguration('magentoHelper')
            .update(SETTING_KEY, relative, vscode.ConfigurationTarget.Workspace);
    } catch {
        // ignore — still run for this session
    }
    return chosen;
}

export async function runTailwind(mode: TailwindMode): Promise<void> {
    const root = workspaceRoot();
    if (!root) {
        vscode.window.showWarningMessage('No workspace folder open.');
        return;
    }

    const configured = vscode.workspace
        .getConfiguration('magentoHelper')
        .get<string>(SETTING_KEY, '')
        .trim();

    let target: string | undefined;
    if (configured) {
        target = resolveConfiguredPath(root, configured);
        if (!target) {
            vscode.window.showWarningMessage(
                `Configured magentoHelper.${SETTING_KEY} not found: ${configured}. Pick a theme to update setting.`
            );
            target = await pickAndPersist(root);
        }
    } else {
        target = await pickAndPersist(root);
    }
    if (!target) return;

    const term = getOrCreateTerminal(target);
    term.show(true);
    const quoted = `"${target.replace(/"/g, '\\"')}"`;
    term.sendText(`cd ${quoted} && npm run ${mode}`, true);
}
