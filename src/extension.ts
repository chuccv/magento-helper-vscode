import * as vscode from 'vscode';
import { LayoutIndex } from './layoutIndex';
import { LayoutDefinitionProvider } from './layoutDefinitionProvider';
import { RoutesIndex } from './routesIndex';
import { ControllerLensProvider } from './controllerLens';
import { PluginIndex } from './pluginIndex';
import { PluginLensProvider } from './pluginLens';
import { XmlClassDefinitionProvider } from './xmlClassDefinitionProvider';
import { XmlClassRefIndex } from './xmlClassRefIndex';
import { PhpUsageLensProvider } from './phpUsageLens';

export function activate(context: vscode.ExtensionContext) {
    const layoutIndex = new LayoutIndex();
    const routesIndex = new RoutesIndex();
    const pluginIndex = new PluginIndex();
    const refIndex = new XmlClassRefIndex();

    // Status bar: shows indexing state + counts
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.command = 'magentoHelper.rebuildIndex';
    context.subscriptions.push(status);

    const setIndexing = () => {
        status.text = '$(sync~spin) Magento: indexing…';
        status.tooltip = 'Magento Helper is scanning XML/PHP. Click to rebuild.';
        status.show();
    };
    const setReady = (durationMs: number) => {
        const l = layoutIndex.size();
        const r = routesIndex.size();
        const p = pluginIndex.size();
        const x = refIndex.size();
        status.text = `$(check) Magento: ${l}L / ${r}R / ${p}P / ${x}X`;
        status.tooltip = `Magento Helper ready (${durationMs}ms)\n` +
            `${l} layout names · ${r} route modules · ${p} plugin classes · ${x} class refs\n` +
            `Click to rebuild index.`;
        status.show();
    };
    const setError = (err: unknown) => {
        status.text = '$(error) Magento: index failed';
        status.tooltip = `Magento Helper error: ${(err as Error)?.message ?? err}\nClick to retry.`;
        status.show();
    };

    const buildAll = async () => {
        setIndexing();
        const t0 = Date.now();
        try {
            await Promise.all([
                layoutIndex.build(true),
                routesIndex.build(),
                pluginIndex.build(),
                refIndex.build()
            ]);
            setReady(Date.now() - t0);
        } catch (e) {
            setError(e);
        }
    };

    buildAll();

    // Watchers
    const layoutWatcher = vscode.workspace.createFileSystemWatcher('**/{layout,page_layout}/**/*.xml');
    layoutWatcher.onDidChange(uri => layoutIndex.refreshFile(uri));
    layoutWatcher.onDidCreate(uri => layoutIndex.refreshFile(uri));
    layoutWatcher.onDidDelete(uri => layoutIndex.removeFile(uri));
    context.subscriptions.push(layoutWatcher);

    const diWatcher = vscode.workspace.createFileSystemWatcher('**/etc/**/di.xml');
    diWatcher.onDidChange(() => pluginIndex.build());
    diWatcher.onDidCreate(() => pluginIndex.build());
    diWatcher.onDidDelete(() => pluginIndex.build());
    context.subscriptions.push(diWatcher);

    const routesWatcher = vscode.workspace.createFileSystemWatcher('**/etc/**/routes.xml');
    routesWatcher.onDidChange(() => routesIndex.build());
    routesWatcher.onDidCreate(() => routesIndex.build());
    routesWatcher.onDidDelete(() => routesIndex.build());
    context.subscriptions.push(routesWatcher);

    // Providers
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'xml' },
            new LayoutDefinitionProvider(layoutIndex)
        ),
        vscode.languages.registerDefinitionProvider(
            { language: 'xml' },
            new XmlClassDefinitionProvider()
        ),
        vscode.languages.registerCodeLensProvider(
            { language: 'php' },
            new ControllerLensProvider(routesIndex)
        ),
        vscode.languages.registerCodeLensProvider(
            { language: 'php' },
            new PluginLensProvider(pluginIndex)
        ),
        vscode.languages.registerCodeLensProvider(
            { language: 'php' },
            new PhpUsageLensProvider(refIndex)
        )
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('magentoHelper.rebuildIndex', () => buildAll()),
        vscode.commands.registerCommand('magentoHelper.openLayoutFiles', async (files: string[]) => {
            if (files.length === 1) {
                const doc = await vscode.workspace.openTextDocument(files[0]);
                await vscode.window.showTextDocument(doc);
                return;
            }
            const pick = await vscode.window.showQuickPick(files, { placeHolder: 'Open layout file' });
            if (pick) {
                const doc = await vscode.workspace.openTextDocument(pick);
                await vscode.window.showTextDocument(doc);
            }
        }),
        vscode.commands.registerCommand('magentoHelper.gotoLocations', async (locations: vscode.Location[]) => {
            if (!locations || locations.length === 0) return;
            if (locations.length === 1) {
                const loc = locations[0];
                const doc = await vscode.workspace.openTextDocument(loc.uri);
                const editor = await vscode.window.showTextDocument(doc);
                editor.selection = new vscode.Selection(loc.range.start, loc.range.start);
                editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenter);
                return;
            }
            await vscode.commands.executeCommand('editor.action.peekLocations',
                locations[0].uri, locations[0].range.start, locations, 'peek');
        })
    );
}

export function deactivate() {}
