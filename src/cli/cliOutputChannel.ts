import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getCliOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Magento CLI');
    }
    return channel;
}

export function disposeCliOutputChannel(): void {
    channel?.dispose();
    channel = undefined;
}
