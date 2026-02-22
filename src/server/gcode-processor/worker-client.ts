import { Worker } from 'worker_threads';
import path from 'path';
import { InspectOptions, ProcessOptions, inspectGCode as inspectGCodeImpl, processGCode as processGCodeImpl } from './gcode-processor';

// We reuse the return types from the implementation
type InspectResult = Awaited<ReturnType<typeof inspectGCodeImpl>>;
type ProcessResult = Awaited<ReturnType<typeof processGCodeImpl>>;

const WORKER_PATH = path.join(__dirname, 'worker.js'); // Assuming compiled output

const runWorker = <T>(
	type: 'inspect' | 'process',
	payload: any,
	options: InspectOptions | ProcessOptions,
): Promise<T> => {
	return new Promise((resolve, reject) => {
		// We need to resolve the correct path for the worker.
		// In Next.js/Webpack environment, this can be tricky.
		// For now, we assume standard Node execution or that the worker file is placed correctly.
		// A more robust solution might involve using a loader or specific path handling.
		
		// Adjust worker path for potential different execution contexts (ts-node vs node)
		const workerPath = __filename.endsWith('.ts') 
            ? path.join(__dirname, 'worker.ts') 
            : path.join(__dirname, 'worker.js');

		const worker = new Worker(workerPath, {
            // execArgv needs to be handled if running in ts-node to support TS in worker
            execArgv: __filename.endsWith('.ts') ? ['-r', 'ts-node/register'] : undefined
        });

		const { onProgress, onWarning, abortSignal, ...serializableOptions } = options;

		worker.postMessage({
			type,
			...payload,
			options: serializableOptions,
		});

		worker.on('message', (message) => {
			switch (message.type) {
				case 'success':
					resolve(message.result);
					worker.terminate();
					break;
				case 'error':
					const error = new Error(message.error.message);
					error.stack = message.error.stack;
					error.name = message.error.name;
					Object.assign(error, message.error);
					reject(error);
					worker.terminate();
					break;
				case 'progress':
					if (onProgress) {
						onProgress(message.progress);
					}
					break;
				case 'warning':
					if (onWarning) {
						onWarning(message.code, message.message);
					}
					break;
			}
		});

		worker.on('error', (err) => {
			reject(err);
			worker.terminate();
		});

		worker.on('exit', (code) => {
			if (code !== 0) {
				reject(new Error(`Worker stopped with exit code ${code}`));
			}
		});
		
		if (abortSignal) {
			abortSignal.addEventListener('abort', () => {
				worker.terminate();
				reject(new Error('Aborted'));
			});
		}
	});
};

export async function inspectGCodeAsync(inputFile: string, options: InspectOptions): Promise<InspectResult> {
	return runWorker<InspectResult>('inspect', { inputFile }, options);
}

export async function processGCodeAsync(
	inputFile: string,
	outputFile: string,
	options: ProcessOptions,
): Promise<ProcessResult> {
	return runWorker<ProcessResult>('process', { inputFile, outputFile }, options);
}
