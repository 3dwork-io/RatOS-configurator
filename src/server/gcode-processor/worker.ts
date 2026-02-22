import { parentPort } from 'worker_threads';
import { inspectGCode, processGCode } from './gcode-processor';
import { GCodeProcessorOptions } from './GCodeProcessor';

if (!parentPort) {
	throw new Error('Must be run as a worker');
}

parentPort.on('message', async (message) => {
	try {
		if (message.type === 'inspect') {
			const options = message.options;
			// Reconstruct callbacks proxy
			const optionsWithCallbacks = {
				...options,
				onProgress: (progress: any) => parentPort!.postMessage({ type: 'progress', progress }),
				onWarning: (code: string, msg: string) =>
					parentPort!.postMessage({ type: 'warning', code, message: msg }),
				// AbortSignal handling would require a MessagePort or similar, skipping for now as it's complex to serialize
				abortSignal: undefined,
			};

			const result = await inspectGCode(message.inputFile, optionsWithCallbacks);
			parentPort!.postMessage({ type: 'success', result });
		} else if (message.type === 'process') {
			const options = message.options;
			const optionsWithCallbacks = {
				...options,
				onProgress: (progress: any) => parentPort!.postMessage({ type: 'progress', progress }),
				onWarning: (code: string, msg: string) =>
					parentPort!.postMessage({ type: 'warning', code, message: msg }),
				abortSignal: undefined,
			};

			const result = await processGCode(message.inputFile, message.outputFile, optionsWithCallbacks);
			parentPort!.postMessage({ type: 'success', result });
		}
	} catch (e: any) {
		parentPort!.postMessage({
			type: 'error',
			error: {
				message: e.message,
				stack: e.stack,
				name: e.name,
				// Copy any other properties that might be relevant
				...e,
			},
		});
	}
});
