import { CliCommand, CliArgument } from './cliTypes';

function ns(name: string): string {
    const i = name.indexOf(':');
    return i >= 0 ? name.substring(0, i) : '_';
}

function cmd(name: string, description: string, args: CliArgument[] = []): CliCommand {
    return { name, namespace: ns(name), description, args, source: 'core' };
}

// Hardcoded core commands. Used before the first `list` refresh and to
// generate Command Palette entries (see scripts/gen-cli-commands.js).
// No vscode imports here so the script can require this module from Node.
export const CORE_COMMANDS: CliCommand[] = [
    cmd('cache:flush', 'Flushes cache storage used by cache types', [
        { name: 'types', required: false, description: 'Space-separated list of cache types' },
    ]),
    cmd('cache:clean', 'Cleans cache type(s)', [
        { name: 'types', required: false, description: 'Space-separated list of cache types' },
    ]),
    cmd('cache:enable', 'Enables cache type(s)'),
    cmd('cache:disable', 'Disables cache type(s)'),
    cmd('cache:status', 'Checks cache status'),

    cmd('indexer:reindex', 'Reindexes data', [
        { name: 'index', required: false, description: 'Space-separated list of index codes' },
    ]),
    cmd('indexer:status', 'Shows status of indexer'),
    cmd('indexer:info', 'Shows allowed indexers'),
    cmd('indexer:reset', 'Resets indexer status to invalid'),
    cmd('indexer:set-mode', 'Sets index mode type', [
        { name: 'mode', required: true, description: 'realtime|schedule' },
        { name: 'index', required: false, description: 'Space-separated indexer codes' },
    ]),
    cmd('indexer:show-mode', 'Shows mode of indexer'),

    cmd('setup:upgrade', 'Upgrades the Magento application, DB data, and schema'),
    cmd('setup:di:compile', 'Generates DI configuration and all missing classes'),
    cmd('setup:static-content:deploy', 'Deploys static view files', [
        { name: 'languages', required: false, description: 'Space-separated locale codes' },
    ]),
    cmd('setup:db:status', 'Checks if DB schema or data requires upgrade'),
    cmd('setup:db-schema:upgrade', 'Installs and upgrades the DB schema'),
    cmd('setup:db-data:upgrade', 'Installs and upgrades data in the DB'),
    cmd('setup:store-config:set', 'Installs the store configuration'),
    cmd('setup:config:set', 'Creates or modifies the deployment configuration'),

    cmd('deploy:mode:show', 'Displays current application mode'),
    cmd('deploy:mode:set', 'Sets the application mode', [
        { name: 'mode', required: true, description: 'developer|production|default' },
    ]),

    cmd('maintenance:enable', 'Enables maintenance mode'),
    cmd('maintenance:disable', 'Disables maintenance mode'),
    cmd('maintenance:status', 'Displays maintenance mode status'),
    cmd('maintenance:allow-ips', 'Sets maintenance mode exempt IPs', [
        { name: 'ip', required: false, description: 'Allowed IP addresses' },
    ]),

    cmd('module:enable', 'Enables specified modules', [
        { name: 'module', required: true, description: 'Module name(s), space-separated' },
    ]),
    cmd('module:disable', 'Disables specified modules', [
        { name: 'module', required: true, description: 'Module name(s), space-separated' },
    ]),
    cmd('module:status', 'Displays status of modules'),
    cmd('module:uninstall', 'Uninstalls modules', [
        { name: 'module', required: true, description: 'Module name(s)' },
    ]),

    cmd('admin:user:create', 'Creates an administrator'),
    cmd('admin:user:unlock', 'Unlocks an admin account', [
        { name: 'username', required: true, description: 'Admin username' },
    ]),

    cmd('config:set', 'Changes system configuration', [
        { name: 'path', required: true, description: 'Configuration path' },
        { name: 'value', required: true, description: 'Configuration value' },
    ]),
    cmd('config:show', 'Shows configuration value', [
        { name: 'path', required: false, description: 'Configuration path' },
    ]),
    cmd('config:sensitive:set', 'Sets sensitive configuration values', [
        { name: 'path', required: true, description: 'Configuration path' },
        { name: 'value', required: true, description: 'Configuration value' },
    ]),

    cmd('app:config:dump', 'Creates dump of application'),
    cmd('app:config:import', 'Imports data from shared configuration files'),
    cmd('app:config:status', 'Checks if application config is up to date'),

    cmd('cron:run', 'Runs jobs by schedule'),
    cmd('cron:install', 'Generates and installs crontab for current user'),
    cmd('cron:remove', 'Removes Magento crontab'),

    cmd('queue:consumers:list', 'Lists all available message queue consumers'),
    cmd('queue:consumers:start', 'Starts a message queue consumer', [
        { name: 'consumer', required: true, description: 'The consumer name' },
    ]),

    cmd('dev:tests:run', 'Runs tests', [
        { name: 'type', required: true, description: 'Test type (unit|integration|...)' },
    ]),
    cmd('dev:source-theme:deploy', 'Collects and publishes source files for theme'),
    cmd('dev:di:info', 'Provides information on Dependency Injection configuration', [
        { name: 'class', required: true, description: 'Class name' },
    ]),
    cmd('dev:urn-catalog:generate', 'Generates the catalog of URNs to *.xsd', [
        { name: 'path', required: true, description: 'Path to .idea/misc.xml' },
    ]),
    cmd('dev:profiler:enable', 'Enables profiler'),
    cmd('dev:profiler:disable', 'Disables profiler'),
    cmd('dev:query-log:enable', 'Enables DB query logging'),
    cmd('dev:query-log:disable', 'Disables DB query logging'),
    cmd('dev:template-hints:enable', 'Enables template hints in storefront'),
    cmd('dev:template-hints:disable', 'Disables template hints in storefront'),
    cmd('dev:xml:convert', 'Converts XML file using XSL stylesheets'),

    cmd('catalog:images:resize', 'Creates resized product images'),
    cmd('catalog:product:attributes:cleanup', 'Removes unused product attributes'),

    cmd('customer:hash:upgrade', 'Upgrade customer hash according to the latest algorithm'),

    cmd('info:adminuri', 'Displays the Magento Admin URI'),
    cmd('info:backups:list', 'Prints list of available backup files'),
    cmd('info:currency:list', 'Displays the list of available currencies'),
    cmd('info:language:list', 'Displays the list of available language locales'),
    cmd('info:timezone:list', 'Displays the list of available timezones'),
    cmd('info:dependencies:show-modules', 'Shows number of dependencies on other modules'),
    cmd('info:dependencies:show-modules-circular', 'Shows number of circular dependencies'),

    cmd('store:list', 'Displays the list of stores'),
    cmd('store:website:list', 'Displays the list of websites'),

    cmd('theme:uninstall', 'Uninstalls theme', [
        { name: 'theme', required: true, description: 'Theme path' },
    ]),

    cmd('i18n:collect-phrases', 'Discovers phrases in the codebase'),
    cmd('i18n:pack', 'Saves language package'),

    cmd('list', 'Lists commands'),
    cmd('help', 'Displays help for a command', [
        { name: 'command_name', required: false, description: 'The command name' },
    ]),
];

export const FAVORITE_NAMES = [
    'cache:flush',
    'cache:clean',
    'setup:upgrade',
    'setup:di:compile',
    'setup:static-content:deploy',
    'indexer:reindex',
    'maintenance:enable',
    'maintenance:disable',
];
