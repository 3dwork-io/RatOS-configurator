import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

interface NodeExecError extends Error {
	code?: number;
	stdout?: string;
	stderr?: string;
}

function isNodeExecError(error: unknown): error is NodeExecError {
	return error instanceof Error && 'code' in error;
}

export const GitService = {
	diff: async (fileA: string, fileB: string): Promise<string> => {
		try {
			const { stdout } = await execFileAsync('git', [
				'diff',
				'--minimal',
				'--no-ext-diff',
				'--no-index',
				fileA,
				fileB,
			]);
			return stdout;
		} catch (error: unknown) {
			// git diff returns exit code 1 if there are differences.
			if (isNodeExecError(error) && error.code === 1 && typeof error.stdout === 'string') {
				return error.stdout;
			}
			throw error;
		}
	},
};
