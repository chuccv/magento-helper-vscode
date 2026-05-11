import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getCliOutputChannel } from './cliOutputChannel';

const TERMINAL_NAME = 'Magento CLI';

export interface RunState {
    running: boolean;
    name?: string;
    startedAt?: number;
}

export class MagentoCliError extends Error {}

export interface HeadlessResult {
    stdout: string;
    stderr: string;
    code: number;
}

export class CliExecutor {
    private terminal: vscode.Terminal | undefined;
    private _onRunStateChange = new vscode.EventEmitter<RunState>();
    readonly onRunStateChange = this._onRunStateChange.event;
    private currentState: RunState = { running: false };

    constructor() {
        vscode.window.onDidCloseTerminal(t => {
            if (t === this.terminal) this.terminal = undefined;
        });
    }

    getRunState(): RunState {
        return this.currentState;
    }

    private setState(s: RunState): void {
        this.currentState = s;
        this._onRunStateChange.fire(s);
    }

    private workspaceRoot(): string {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            throw new MagentoCliError('No workspace folder open.');
        }
        return folders[0].uri.fsPath;
    }

    resolveCwd(): string {
        const cfg = vscode.workspace.getConfiguration('magentoHelper.cli');
        const cwd = cfg.get<string>('cwd', '').trim();
        if (cwd) {
            return path.isAbsolute(cwd) ? cwd : path.join(this.workspaceRoot(), cwd);
        }
        return this.workspaceRoot();
    }

    resolvePrefix(): string[] {
        const cfg = vscode.workspace.getConfiguration('magentoHelper.cli');
        const raw = cfg.get<string>('command', 'bin/magento').trim();
        const autoDetect = cfg.get<boolean>('autoDetectDdev', true);
        const isDefault = raw === 'bin/magento';
        if (isDefault && autoDetect) {
            try {
                const ddevConfig = path.join(this.workspaceRoot(), '.ddev', 'config.yaml');
                if (fs.existsSync(ddevConfig)) return ['ddev', 'magento'];
            } catch {
                // No workspace; fall through to default
            }
        }
        return raw.split(/\s+/).filter(Boolean);
    }

    private quote(arg: string): string {
        if (arg === '') return '""';
        if (/^[A-Za-z0-9_:=./@-]+$/.test(arg)) return arg;
        return '"' + arg.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    private buildLine(commandName: string, args: string[]): string {
        const prefix = this.resolvePrefix();
        return [...prefix, commandName, ...args].map(t => this.quote(t)).join(' ');
    }

    private getOrCreateTerminal(): vscode.Terminal {
        if (!this.terminal) {
            this.terminal = vscode.window.createTerminal({
                name: TERMINAL_NAME,
                cwd: this.resolveCwd(),
            });
        }
        return this.terminal;
    }

    runInTerminal(commandName: string, args: string[], opts?: { execute?: boolean }): void {
        const line = this.buildLine(commandName, args);
        const term = this.getOrCreateTerminal();
        term.show(true);
        term.sendText(line, opts?.execute ?? false);
    }

    async runSilent(commandName: string, args: string[]): Promise<HeadlessResult> {
        const out = getCliOutputChannel();
        const fullCmd = [...this.resolvePrefix(), commandName, ...args].join(' ');
        const ts = new Date().toLocaleTimeString();
        out.appendLine('');
        out.appendLine(`──[${ts}] $ ${fullCmd}`);
        this.setState({ running: true, name: commandName, startedAt: Date.now() });
        try {
            const result = await this.runHeadlessStream(commandName, args, chunk => out.append(chunk), 0);
            const dur = ((Date.now() - (this.currentState.startedAt ?? Date.now())) / 1000).toFixed(1);
            out.appendLine('');
            out.appendLine(`──[exit ${result.code}, ${dur}s]`);
            return result;
        } finally {
            this.setState({ running: false });
        }
    }

    private runHeadlessStream(
        commandName: string,
        args: string[],
        onChunk: (s: string) => void,
        timeoutMs: number
    ): Promise<HeadlessResult> {
        return new Promise((resolve, reject) => {
            const prefix = this.resolvePrefix();
            if (prefix.length === 0) {
                reject(new MagentoCliError('Empty CLI command setting.'));
                return;
            }
            const [cmd, ...prefixArgs] = prefix;
            let cwd: string;
            try {
                cwd = this.resolveCwd();
            } catch (e) {
                reject(e);
                return;
            }
            const child = spawn(cmd, [...prefixArgs, commandName, ...args], { cwd, shell: false });
            let stdout = '';
            let stderr = '';
            const timer = timeoutMs > 0
                ? setTimeout(() => {
                    child.kill('SIGTERM');
                    reject(new MagentoCliError(`Timeout after ${timeoutMs}ms: ${commandName}`));
                }, timeoutMs)
                : undefined;
            child.stdout.on('data', d => {
                const s = d.toString();
                stdout += s;
                onChunk(s);
            });
            child.stderr.on('data', d => {
                const s = d.toString();
                stderr += s;
                onChunk(s);
            });
            child.on('error', err => {
                if (timer) clearTimeout(timer);
                reject(err);
            });
            child.on('close', code => {
                if (timer) clearTimeout(timer);
                resolve({ stdout, stderr, code: code ?? -1 });
            });
        });
    }

    runHeadless(commandName: string, args: string[], timeoutMs = 30000): Promise<HeadlessResult> {
        return new Promise((resolve, reject) => {
            const prefix = this.resolvePrefix();
            if (prefix.length === 0) {
                reject(new MagentoCliError('Empty CLI command setting.'));
                return;
            }
            const [cmd, ...prefixArgs] = prefix;
            let cwd: string;
            try {
                cwd = this.resolveCwd();
            } catch (e) {
                reject(e);
                return;
            }
            const child = spawn(cmd, [...prefixArgs, commandName, ...args], {
                cwd,
                shell: false,
            });
            let stdout = '';
            let stderr = '';
            const timer = setTimeout(() => {
                child.kill('SIGTERM');
                reject(new MagentoCliError(`Timeout after ${timeoutMs}ms: ${commandName}`));
            }, timeoutMs);
            child.stdout.on('data', d => (stdout += d.toString()));
            child.stderr.on('data', d => (stderr += d.toString()));
            child.on('error', err => {
                clearTimeout(timer);
                reject(err);
            });
            child.on('close', code => {
                clearTimeout(timer);
                resolve({ stdout, stderr, code: code ?? -1 });
            });
        });
    }
}
