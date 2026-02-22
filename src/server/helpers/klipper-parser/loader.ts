import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { KlipperParser } from './index';
import { KlipperFile, KlipperInclude, KlipperNode } from './types';

export class KlipperLoader {
	private processedFiles: Set<string> = new Set();

	constructor() {}

	public async load(filePath: string): Promise<KlipperFile> {
		const absolutePath = path.resolve(filePath);
		
		if (this.processedFiles.has(absolutePath)) {
			return {
				path: absolutePath,
				content: '',
				nodes: [],
			};
		}
		
		this.processedFiles.add(absolutePath);

		try {
			await fsPromises.access(absolutePath);
		} catch {
			throw new Error(`File not found: ${absolutePath}`);
		}

		const content = await fsPromises.readFile(absolutePath, 'utf-8');
		const parser = new KlipperParser(content);
		const nodes = parser.parse();

		const file: KlipperFile = {
			path: absolutePath,
			content,
			nodes,
		};

		// Resolve includes
		await this.resolveIncludes(nodes, path.dirname(absolutePath));

		return file;
	}

	private async resolveIncludes(nodes: KlipperNode[], baseDir: string): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const node of nodes) {
			if (node.type === 'Include') {
				promises.push(this.resolveInclude(node, baseDir));
			} else if (node.type === 'Section') {
				promises.push(this.resolveIncludes(node.children, baseDir));
			}
		}
		await Promise.all(promises);
	}

	private async resolveInclude(includeNode: KlipperInclude, baseDir: string): Promise<void> {
		// Klipper includes are relative to the directory containing the config file.
		let includePath = includeNode.path;
		
		let resolvedPath: string;
		if (path.isAbsolute(includePath)) {
			resolvedPath = includePath;
		} else {
			if (includePath.startsWith('~/')) {
				const homeDir = process.env.HOME || process.env.USERPROFILE || '';
				resolvedPath = path.join(homeDir, includePath.substring(2));
			} else {
				resolvedPath = path.join(baseDir, includePath);
			}
		}

		try {
			// Reuse `this` to detect cycles globally in this load tree.
			includeNode.resolvedFile = await this.load(resolvedPath);
		} catch (e) {
			console.warn(`Failed to resolve include: ${resolvedPath}`, e);
		}
	}
}
