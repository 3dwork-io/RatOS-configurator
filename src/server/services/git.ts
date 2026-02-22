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
    isRepo: async (cwd: string): Promise<boolean> => {
        try {
            await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd });
            return true;
        } catch {
            return false;
        }
    },
    init: async (cwd: string): Promise<void> => {
        await execFileAsync('git', ['init'], { cwd });
    },
    add: async (cwd: string, files: string[] | string = '.'): Promise<void> => {
        const fileArgs = Array.isArray(files) ? files : [files];
        await execFileAsync('git', ['add', ...fileArgs], { cwd });
    },
    commit: async (cwd: string, message: string): Promise<void> => {
        // Configure user if not set?
        // For now assume git user is configured or pass -c
        try {
            await execFileAsync('git', ['commit', '-m', message], { cwd });
        } catch (error) {
             // Ignore "nothing to commit" errors?
             if (isNodeExecError(error) && error.stdout?.includes('nothing to commit')) {
                 return;
             }
             throw error;
        }
    }
};
