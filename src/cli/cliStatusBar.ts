import * as vscode from 'vscode';
import { CliExecutor, MagentoCliError, RunState } from './cliExecutor';
import { getCliOutputChannel } from './cliOutputChannel';

interface StatusSnapshot {
    mode: string | null;
    maintenance: 'on' | 'off' | null;
    error?: string;
}

const CMD_CLICK = 'magentoHelper.cli.statusBarClick';

// Strip ANSI color/escape codes (e.g. ddev wraps output with `\x1b[33m...\x1b[0m`).
function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\[[0-9;]+m/g, '');
}

function truncate(s: string, maxLines = 6, maxChars = 400): string {
    const trimmed = s.trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/);
    let out = lines.slice(0, maxLines).join('\n');
    if (lines.length > maxLines) out += `\n…(+${lines.length - maxLines} lines)`;
    if (out.length > maxChars) out = out.slice(0, maxChars) + '…';
    return out;
}

export class CliStatusBar implements vscode.Disposable {
    private item: vscode.StatusBarItem | undefined;
    private timer: NodeJS.Timeout | undefined;
    private clickReg: vscode.Disposable | undefined;
    private cfgReg: vscode.Disposable | undefined;
    private last: StatusSnapshot = { mode: null, maintenance: null };
    private runState: RunState = { running: false };
    private runReg: vscode.Disposable | undefined;
    private runTicker: NodeJS.Timeout | undefined;

    constructor(private executor: CliExecutor) {}

    start(context: vscode.ExtensionContext): void {
        this.clickReg = vscode.commands.registerCommand(CMD_CLICK, () => this.handleClick());
        context.subscriptions.push(this.clickReg);

        this.runReg = this.executor.onRunStateChange(s => {
            this.runState = s;
            this.stopRunTicker();
            if (s.running) {
                this.runTicker = setInterval(() => this.render(), 1000);
            }
            this.render();
            if (!s.running) void this.refresh();
        });
        context.subscriptions.push(this.runReg);

        this.cfgReg = vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('magentoHelper.cli')) this.applyConfig();
        });
        context.subscriptions.push(this.cfgReg);

        this.applyConfig();
    }

    private applyConfig(): void {
        const cfg = vscode.workspace.getConfiguration('magentoHelper.cli.statusBar');
        const enabled = cfg.get<boolean>('enabled', true);
        const intervalSec = cfg.get<number>('refreshIntervalSec', 60);

        this.stopTimer();

        if (!enabled) {
            this.disposeItem();
            return;
        }

        if (!this.item) {
            this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
            this.item.command = CMD_CLICK;
        }
        this.render();
        this.item.show();
        void this.refresh();

        if (intervalSec > 0) {
            this.timer = setInterval(() => void this.refresh(), intervalSec * 1000);
        }
    }

    private stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    private disposeItem(): void {
        this.item?.dispose();
        this.item = undefined;
    }

    async refresh(): Promise<void> {
        if (!this.item) return;
        try {
            const [modeRes, maintRes] = await Promise.all([
                this.executor.runHeadless('deploy:mode:show', []),
                this.executor.runHeadless('maintenance:status', []),
            ]);
            const modeOut = stripAnsi(modeRes.stdout) + '\n' + stripAnsi(modeRes.stderr);
            const maintOut = stripAnsi(maintRes.stdout) + '\n' + stripAnsi(maintRes.stderr);
            const mode = this.parseMode(modeOut);
            const maintenance = this.parseMaintenance(maintOut);
            const errParts: string[] = [];
            if (mode === null && modeRes.stderr) errParts.push(truncate(stripAnsi(modeRes.stderr)));
            if (maintenance === null && maintRes.stderr) errParts.push(truncate(stripAnsi(maintRes.stderr)));
            this.last = {
                mode,
                maintenance,
                error: errParts.length > 0 ? errParts.join('\n---\n') : undefined,
            };
        } catch (e) {
            const msg = e instanceof MagentoCliError ? e.message : (e as Error).message;
            this.last = { mode: null, maintenance: null, error: truncate(msg) };
        }
        this.render();
    }

    private parseMode(text: string): string | null {
        const m = text.match(/Current application mode:\s*(\S+)/i);
        return m ? m[1].replace(/\.$/, '') : null;
    }

    private parseMaintenance(text: string): 'on' | 'off' | null {
        if (/maintenance mode is\s+active/i.test(text)) return 'on';
        if (/maintenance mode is\s+not active/i.test(text)) return 'off';
        return null;
    }

    private render(): void {
        if (!this.item) return;
        if (this.runState.running) {
            const elapsed = this.runState.startedAt
                ? Math.max(0, Math.round((Date.now() - this.runState.startedAt) / 1000))
                : 0;
            this.item.text = `$(sync~spin) M2: ${this.runState.name ?? 'running'} (${elapsed}s)`;
            this.item.tooltip = `Running ${this.runState.name}…\nClick to open output log.`;
            return;
        }
        const mode = this.last.mode ?? '?';
        const maint = this.last.maintenance ?? '?';
        if (this.last.mode === null && this.last.maintenance === null) {
            this.item.text = '$(question) M2: ?';
        } else {
            const icon = this.last.maintenance === 'on' ? '$(warning)' : '$(server)';
            this.item.text = `${icon} M2: ${mode} | maint:${maint}`;
        }
        const tooltipLines = [
            `Deploy mode: ${mode}`,
            `Maintenance: ${maint}`,
            'Click for quick actions.',
        ];
        if (this.last.error) tooltipLines.push('', this.last.error);
        this.item.tooltip = tooltipLines.join('\n');
    }

    private handleClick(): void | Promise<void> {
        if (this.runState.running) {
            getCliOutputChannel().show(true);
            return;
        }
        return this.showQuickActions();
    }

    private async showQuickActions(): Promise<void> {
        const cfg = vscode.workspace.getConfiguration('magentoHelper.cli');
        const cliCmd = cfg.get<string>('command', 'bin/magento');
        const cliCwd = cfg.get<string>('cwd', '') || '<workspace root>';
        const runMode = cfg.get<string>('defaultRunMode', 'terminal');
        const sep = (label: string): vscode.QuickPickItem & { action: () => void } => ({
            label, kind: vscode.QuickPickItemKind.Separator, action: () => { /* noop */ },
        });
        const items: Array<vscode.QuickPickItem & { action: () => void | Promise<void> }> = [
            sep('Status'),
            {
                label: '$(refresh) Refresh status',
                action: () => this.refresh(),
            },
            {
                label:
                    this.last.maintenance === 'on'
                        ? '$(check) Disable maintenance mode'
                        : '$(warning) Enable maintenance mode',
                action: async () => {
                    const target = this.last.maintenance === 'on' ? 'maintenance:disable' : 'maintenance:enable';
                    this.executor.runInTerminal(target, [], { execute: true });
                },
            },
            {
                label: '$(tools) Switch deploy mode → developer',
                action: () => this.executor.runInTerminal('deploy:mode:set', ['developer'], { execute: true }),
            },
            {
                label: '$(rocket) Switch deploy mode → production',
                action: () => this.executor.runInTerminal('deploy:mode:set', ['production'], { execute: true }),
            },
            sep('Run'),
            {
                label: '$(terminal) Run CLI command (terminal)…',
                action: () => vscode.commands.executeCommand('magentoHelper.cli.run'),
            },
            {
                label: '$(zap) Run CLI command (silent → log)…',
                action: () => vscode.commands.executeCommand('magentoHelper.cli.runSilent'),
            },
            {
                label: '$(star) Run favorite CLI command…',
                action: () => vscode.commands.executeCommand('magentoHelper.cli.runFavorite'),
            },
            {
                label: '$(output) Open CLI log',
                action: () => vscode.commands.executeCommand('magentoHelper.cli.openLog'),
            },
            {
                label: '$(sync) Refresh CLI catalog (run `bin/magento list`)',
                action: () => vscode.commands.executeCommand('magentoHelper.cli.refreshCatalog'),
            },
            sep('Settings'),
            {
                label: '$(gear) CLI command',
                description: cliCmd,
                action: () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'magentoHelper.cli.command'),
            },
            {
                label: '$(folder) CLI working directory',
                description: cliCwd,
                action: () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'magentoHelper.cli.cwd'),
            },
            {
                label: '$(symbol-boolean) Auto-detect DDEV',
                description: String(cfg.get<boolean>('autoDetectDdev', true)),
                action: () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'magentoHelper.cli.autoDetectDdev'),
            },
            {
                label: '$(play) Default run mode',
                description: runMode,
                action: () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'magentoHelper.cli.defaultRunMode'),
            },
            {
                label: '$(settings) Open all Magento Helper settings',
                action: () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'magentoHelper'),
            },
        ];
        const pick = await vscode.window.showQuickPick(items, {
            placeHolder: 'Magento quick actions',
        });
        if (pick) await pick.action();
    }

    private stopRunTicker(): void {
        if (this.runTicker) {
            clearInterval(this.runTicker);
            this.runTicker = undefined;
        }
    }

    dispose(): void {
        this.stopTimer();
        this.stopRunTicker();
        this.disposeItem();
    }
}
