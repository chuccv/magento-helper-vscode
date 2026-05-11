#!/usr/bin/env node
// Regenerates the per-magento-CLI-command palette entries in package.json
// from CORE_COMMANDS. Run after editing src/cli/cliCatalog.ts.
//
// Usage: npm run compile && node scripts/gen-cli-commands.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');

const { CORE_COMMANDS } = require(path.join(ROOT, 'out', 'cli', 'cliCoreCommands.js'));

const COMMAND_PREFIX = 'magentoHelper.cli.cmd:';
const STATIC_COMMANDS = [
    { command: 'magentoHelper.rebuildIndex', title: 'Magento Helper: Rebuild Index' },
    { command: 'magentoHelper.openLayoutFiles', title: 'Magento Helper: Open Layout Files' },
    { command: 'magentoHelper.gotoLocations', title: 'Magento Helper: Goto Locations' },
    { command: 'magentoHelper.generateUrnCatalog', title: 'Magento Helper: Generate URN Catalog' },
    { command: 'magentoHelper.cli.run', title: 'Run CLI Command…', category: 'M2' },
    { command: 'magentoHelper.cli.runFavorite', title: 'Run Favorite CLI Command…', category: 'M2' },
    { command: 'magentoHelper.cli.runSilent', title: 'Run CLI Command (silent, log to output)…', category: 'M2' },
    { command: 'magentoHelper.cli.runFavoriteSilent', title: 'Run Favorite CLI Command (silent)…', category: 'M2' },
    { command: 'magentoHelper.cli.openLog', title: 'Open CLI Log', category: 'M2' },
    { command: 'magentoHelper.cli.refreshCatalog', title: 'Refresh CLI Catalog', category: 'M2' },
    { command: 'magentoHelper.cli.refreshStatus', title: 'Refresh CLI Status', category: 'M2' },
];

const generated = CORE_COMMANDS.map(c => ({
    command: COMMAND_PREFIX + c.name,
    title: c.name + (c.description ? ' — ' + c.description : ''),
    category: 'M2 CLI',
}));

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
pkg.contributes.commands = [...STATIC_COMMANDS, ...generated];

fs.writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 4) + '\n', 'utf8');
console.log(`Wrote ${generated.length} CLI command entries to package.json`);
