import { type ChildProcessWithoutNullStreams, spawn } from 'child_process';

import type { Plugin, Message } from 'esbuild';

const nodeStopEvents = ['exit', 'SIGINT', 'SIGHUP'];

interface IRestartOnRebuildOptions {
    onRebuildStart?: () => void;
    onRebuildEnd?: (ms: number) => void;
    onRebuildFailed?: (errors: Message[], ms: number) => void;

    onServerStart?: () => void;
    onServerClosed?: (code: number | null) => void;

    redirectOutput?: boolean;

    killNodeProcessOnInterrupt?: boolean;
}

export function RestartOnRebuild({
    onRebuildStart,
    onRebuildEnd,
    onRebuildFailed,
    onServerStart,
    onServerClosed,
    redirectOutput = true,
    killNodeProcessOnInterrupt = true,
}: IRestartOnRebuildOptions): Plugin {
    let server: ChildProcessWithoutNullStreams | undefined = undefined;

    function startServer(serverPath: string) {
        server = spawn('node', [serverPath]);

        onServerStart?.();

        if (redirectOutput) {
            server.stdout.pipe(process.stdout);
            server.stderr.pipe(process.stderr);
        }

        server.on('close', code => onServerClosed?.(code));

        return {
            kill: () => server?.kill(),
        };
    }

    function killServer() {
        nodeStopEvents.forEach(event => process.off(event, killServer));

        server?.kill('SIGTERM');

        if (killNodeProcessOnInterrupt) {
            process.exit(0);
        }
    };

    nodeStopEvents.forEach(event => process.on(event, killServer));

    return {
        name: 'restart-on-rebuild',

        setup(build) {
            const resultPath = build.initialOptions.outfile;
            if (typeof resultPath !== 'string') {
                throw new Error('restart-on-rebuild supports only one file (outfile)');
            }

            let started = 0;

            build.onStart(() => {
                server?.kill();

                started = Date.now();

                onRebuildStart?.();
            });

            build.onEnd(result => {
                const delta = Date.now() - started;

                if (result.errors.length > 0) {
                    onRebuildFailed?.(result.errors, delta);
                    return;
                }

                onRebuildEnd?.(delta);

                startServer(resultPath);
            });
        },
    };
}
