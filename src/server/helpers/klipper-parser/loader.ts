import * as fs from 'fs';
import * as path from 'path';
import { KlipperParser } from './index';
import { KlipperFile, KlipperInclude, KlipperNode } from './types';

export class KlipperLoader {
	private processedFiles: Set<string> = new Set();

	constructor() {}

	public load(filePath: string): KlipperFile {
		const absolutePath = path.resolve(filePath);
		
		if (this.processedFiles.has(absolutePath)) {
			// Circular dependency or already processed, usually Klipper errors or ignores.
			// We will just return an empty node list or throw?
			// For analysis, better to return what we have or stop recursion.
			// Let's return empty content to break cycle.
			return {
				path: absolutePath,
				content: '',
				nodes: [],
			};
		}
		
		this.processedFiles.add(absolutePath);

		if (!fs.existsSync(absolutePath)) {
			// If file doesn't exist, we can't parse it. 
			// Return empty or throw. Klipper would error.
			throw new Error(`File not found: ${absolutePath}`);
		}

		const content = fs.readFileSync(absolutePath, 'utf-8');
		const parser = new KlipperParser(content);
		const nodes = parser.parse();

		const file: KlipperFile = {
			path: absolutePath,
			content,
			nodes,
		};

		// Resolve includes
		this.resolveIncludes(nodes, path.dirname(absolutePath));

		return file;
	}

	private resolveIncludes(nodes: KlipperNode[], baseDir: string) {
		for (const node of nodes) {
			if (node.type === 'Include') {
				this.resolveInclude(node, baseDir);
			} else if (node.type === 'Section') {
				this.resolveIncludes(node.children, baseDir);
			}
		}
	}

	private resolveInclude(includeNode: KlipperInclude, baseDir: string) {
		// Klipper includes are relative to the file, or absolute?
		// Usually relative.
		// Also supports ~/ for home dir?
		// Klipper config: "The include file name is relative to the directory containing the config file."
		
		let includePath = includeNode.path;
		
		// Handle ~/ expansion if needed (though usually processed by Klipper env, here we assume standard paths)
		// If path starts with /, it's absolute (linux).
		// In Windows, it might be C:\ or /
		
		let resolvedPath: string;
		if (path.isAbsolute(includePath)) {
			resolvedPath = includePath;
		} else {
			// Handle ~/ ? 
			if (includePath.startsWith('~/')) {
				const homeDir = process.env.HOME || process.env.USERPROFILE || '';
				resolvedPath = path.join(homeDir, includePath.substring(2));
			} else {
				resolvedPath = path.join(baseDir, includePath);
			}
		}

		try {
			// Create a new loader instance or reuse? 
			// If we reuse, we share processedFiles to detect cycles globally in this load tree.
			// Yes, reuse `this`.
			includeNode.resolvedFile = this.load(resolvedPath);
		} catch (e) {
			// If include fails, we might want to log it but keep the node.
			// Klipper would fail startup.
			// We'll leave resolvedFile undefined or partial?
			// Let's catch and maybe log?
			// For now, let it throw or just ignore?
			// If we throw, we stop parsing.
			// Maybe better to ignore missing includes for partial analysis?
			// But user wants to replace metadata.ts which expects valid files.
			// Let's log error and continue.
			console.warn(`Failed to resolve include: ${resolvedPath}`, e);
		}
	}
}
