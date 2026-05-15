import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LayoutIndex } from './layoutIndex';
import { LayoutDefinitionProvider } from './layoutDefinitionProvider';
import { RoutesIndex } from './routesIndex';
import { ControllerLensProvider } from './controllerLens';
import { PluginIndex } from './pluginIndex';
import { PluginLensProvider } from './pluginLens';
import { XmlClassDefinitionProvider } from './xmlClassDefinitionProvider';
import { XmlClassRefIndex } from './xmlClassRefIndex';
import { PhpUsageLensProvider } from './phpUsageLens';
import { generateUrnCatalog } from './urnCatalog';
import { ConfigPathIndex } from './configPathIndex';
import { ModuleIndex } from './moduleIndex';
import { ModuleDefinitionProvider } from './moduleDefinitionProvider';
import { CliExecutor } from './cli/cliExecutor';
import { CliStatusBar } from './cli/cliStatusBar';
import { showRunPicker, showFavoritePicker, runCommandByName } from './cli/cliCommandPicker';
import { refreshCatalog, CORE_COMMANDS } from './cli/cliCatalog';
import { getCliOutputChannel } from './cli/cliOutputChannel';
import { runTailwind } from './cli/cliTailwind';

const CLI_CMD_PREFIX = 'magentoHelper.cli.cmd:';

const CACHE_VERSION = 1;

// Detect a Magento 2 project by the presence of any well-known marker file,
// OR by a composer.json that requires a magento/product-* package (catches
// fresh clones before `composer install`).
function isMagentoProject(): boolean {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return false;
    const markers = [
        ['app', 'etc', 'di.xml'],
        ['bin', 'magento'],
        ['app', 'etc', 'config.php'],
    ];
    for (const folder of folders) {
        const root = folder.uri.fsPath;
        for (const parts of markers) {
            try {
                if (fs.existsSync(path.join(root, ...parts))) return true;
            } catch {
                // ignore
            }
        }
        if (composerRequiresMagento(root)) return true;
    }
    return false;
}

function composerRequiresMagento(root: string): boolean {
    const composerPath = path.join(root, 'composer.json');
    try {
        if (!fs.existsSync(composerPath)) return false;
        const json = JSON.parse(fs.readFileSync(composerPath, 'utf8'));
        const sections = [json.require, json['require-dev']];
        for (const section of sections) {
            if (!section || typeof section !== 'object') continue;
            for (const pkg of Object.keys(section)) {
                if (/^magento\/product-/.test(pkg)) return true;
                if (pkg === 'magento/magento2-base') return true;
            }
        }
    } catch {
        // malformed composer.json → not a reliable signal
    }
    return false;
}

export function activate(context: vscode.ExtensionContext) {
    const layoutIndex = new LayoutIndex();
    const routesIndex = new RoutesIndex();
    const pluginIndex = new PluginIndex();
    const refIndex = new XmlClassRefIndex();
    const configPathIndex = new ConfigPathIndex();
    const moduleIndex = new ModuleIndex();

    // Status bar: shows indexing state + counts
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    status.command = 'magentoHelper.rebuildIndex';
    context.subscriptions.push(status);

    let indexedAt = 0; // 0 = never; otherwise epoch ms of last successful build
    let stale = false;

    const getCachePath = (): string | null => {
        if (!context.storageUri) return null;
        return path.join(context.storageUri.fsPath, 'index-cache.json');
    };

    const saveCache = (): void => {
        const cachePath = getCachePath();
        if (!cachePath) return;
        try {
            fs.mkdirSync(path.dirname(cachePath), { recursive: true });
            const data = JSON.stringify({
                version: CACHE_VERSION,
                indexedAt,
                layout: layoutIndex.serialize(),
                routes: routesIndex.serialize(),
                plugin: pluginIndex.serialize(),
                ref: refIndex.serialize(),
                configPath: configPathIndex.serialize(),
                module: moduleIndex.serialize(),
            });
            fs.writeFileSync(cachePath, data, 'utf8');
        } catch {
            // Non-fatal: cache save failure just means next reload will need manual index
        }
    };

    const loadCache = (): boolean => {
        const cachePath = getCachePath();
        if (!cachePath) return false;
        try {
            const raw = fs.readFileSync(cachePath, 'utf8');
            const data = JSON.parse(raw);
            if (data.version !== CACHE_VERSION) return false;
            layoutIndex.deserialize(data.layout);
            routesIndex.deserialize(data.routes);
            pluginIndex.deserialize(data.plugin);
            refIndex.deserialize(data.ref);
            if (data.configPath) configPathIndex.deserialize(data.configPath);
            if (data.module) moduleIndex.deserialize(data.module);
            indexedAt = data.indexedAt ?? Date.now();
            return true;
        } catch {
            return false;
        }
    };

    const setIndexing = () => {
        status.text = '$(sync~spin) Magento: indexing';
        status.tooltip = 'Scanning XML/PHP…';
        status.show();
    };
    const setReady = () => {
        status.text = '$(check) Magento: indexed';
        status.tooltip = 'Index up to date. Click to rebuild.';
        status.show();
    };
    const setError = (err: unknown) => {
        status.text = '$(error) Magento: failed';
        status.tooltip = `${(err as Error)?.message ?? err}\nClick to retry.`;
        status.show();
    };
    const setIdle = () => {
        status.text = '$(circle-large-outline) Magento: not indexed';
        status.tooltip = 'Click to build index.';
        status.show();
    };
    const setStale = (reason?: string) => {
        status.text = '$(warning) Magento: needs index';
        status.tooltip = (reason ?? 'XML/PHP files changed since last index.') + '\nClick to rebuild.';
        status.show();
    };

    const buildAll = async () => {
        setIndexing();
        try {
            await Promise.all([
                layoutIndex.build(true),
                routesIndex.build(),
                pluginIndex.build(),
                refIndex.build(),
                configPathIndex.build(),
                moduleIndex.build()
            ]);
            indexedAt = Date.now();
            stale = false;
            saveCache();
            setReady();
        } catch (e) {
            setError(e);
        }
    };

    if (loadCache()) {
        setReady();
    } else {
        setIdle();
    }

    // Mark stale when user saves any indexable file. Do NOT rebuild — flag only.
    const isIndexable = (uri: vscode.Uri): boolean => {
        const p = uri.fsPath.replace(/\\/g, '/');
        if (p.endsWith('.xml') && (p.includes('/layout/') || p.includes('/page_layout/') ||
            p.endsWith('/di.xml') || p.endsWith('/routes.xml') || p.endsWith('/events.xml') ||
            p.endsWith('/webapi.xml') || p.endsWith('/system.xml') || p.endsWith('/acl.xml'))) return true;
        if (p.endsWith('registration.php')) return true;
        if (p.endsWith('.php')) return true;
        if (p.endsWith('.phtml')) return true;
        return false;
    };
    const markStale = (reason?: string): void => {
        if (indexedAt === 0) return; // never indexed → keep "not indexed" state
        if (stale) return;
        stale = true;
        setStale(reason);
    };

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(doc => {
            if (!isIndexable(doc.uri)) return;
            markStale();
        })
    );

    // Watch composer.lock to catch new modules added by `composer install / require`.
    // Watch module.xml additions/deletions to catch hand-added modules under app/code.
    // Watch new layout/di/routes XML files to catch new files in already-indexed modules.
    const composerWatcher = vscode.workspace.createFileSystemWatcher('**/composer.lock');
    const moduleWatcher = vscode.workspace.createFileSystemWatcher('**/etc/module.xml');
    const indexedXmlWatcher = vscode.workspace.createFileSystemWatcher(
        '**/{layout,page_layout}/*.xml'
    );
    const diWatcher = vscode.workspace.createFileSystemWatcher(
        '**/etc/**/{di,routes,events,webapi,system,acl,crontab,indexer,mview}.xml'
    );
    const composerReason = 'composer.lock changed — new modules may be installed.';
    const fileAddedReason = 'New Magento XML file detected.';
    composerWatcher.onDidChange(() => markStale(composerReason));
    composerWatcher.onDidCreate(() => markStale(composerReason));
    moduleWatcher.onDidCreate(() => markStale('New module.xml detected.'));
    moduleWatcher.onDidDelete(() => markStale('A module.xml was removed.'));
    indexedXmlWatcher.onDidCreate(() => markStale(fileAddedReason));
    indexedXmlWatcher.onDidDelete(() => markStale(fileAddedReason));
    diWatcher.onDidCreate(() => markStale(fileAddedReason));
    diWatcher.onDidDelete(() => markStale(fileAddedReason));
    context.subscriptions.push(
        composerWatcher, moduleWatcher, indexedXmlWatcher, diWatcher
    );

    // Magento CLI integration (independent of indexing).
    // Only mount the status bar if this workspace looks like a Magento project
    // AND the user has the CLI feature enabled.
    const cliExecutor = new CliExecutor();
    const cliStatusBar = new CliStatusBar(cliExecutor);
    cliStatusBar.start(context, () => isMagentoProject());
    context.subscriptions.push(cliStatusBar);
    // Re-evaluate gating when the toggle changes or workspace folders change.
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('magentoHelper.cli.enabled')) cliStatusBar.reevaluate();
        }),
        vscode.workspace.onDidChangeWorkspaceFolders(() => cliStatusBar.reevaluate())
    );

    // Providers
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { language: 'xml' },
            new LayoutDefinitionProvider(layoutIndex)
        ),
        vscode.languages.registerDefinitionProvider(
            { language: 'xml' },
            new XmlClassDefinitionProvider(layoutIndex, configPathIndex)
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
        ),
        vscode.languages.registerDefinitionProvider(
            [{ language: 'php' }, { language: 'xml' }],
            new ModuleDefinitionProvider(moduleIndex)
        )
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('magentoHelper.rebuildIndex', () => buildAll()),
        vscode.commands.registerCommand('magentoHelper.generateUrnCatalog', () => generateUrnCatalog()),
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
        vscode.commands.registerCommand('magentoHelper.cli.run', () => showRunPicker(context, cliExecutor)),
        vscode.commands.registerCommand('magentoHelper.cli.runFavorite', () => showFavoritePicker(context, cliExecutor)),
        vscode.commands.registerCommand('magentoHelper.cli.refreshCatalog', () => refreshCatalog(context, cliExecutor)),
        vscode.commands.registerCommand('magentoHelper.cli.refreshStatus', () => cliStatusBar.refresh()),
        vscode.commands.registerCommand('magentoHelper.cli.runSilent', () => showRunPicker(context, cliExecutor, 'silent')),
        vscode.commands.registerCommand('magentoHelper.cli.runFavoriteSilent', () => showFavoritePicker(context, cliExecutor, 'silent')),
        vscode.commands.registerCommand('magentoHelper.cli.openLog', () => getCliOutputChannel().show(true)),
        vscode.commands.registerCommand('magentoHelper.cli.tailwindBuild', () => runTailwind('build')),
        vscode.commands.registerCommand('magentoHelper.cli.tailwindWatch', () => runTailwind('watch')),
        ...CORE_COMMANDS.map(c =>
            vscode.commands.registerCommand(CLI_CMD_PREFIX + c.name,
                () => runCommandByName(context, cliExecutor, c.name))
        ),
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
