export interface CliArgument {
    name: string;
    description?: string;
    required: boolean;
}

export interface CliCommand {
    name: string;
    namespace: string;
    description: string;
    args: CliArgument[];
    source: 'core' | 'discovered';
}
