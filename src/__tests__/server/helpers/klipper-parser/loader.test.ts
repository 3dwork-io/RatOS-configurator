
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KlipperLoader } from '@/server/helpers/klipper-parser/loader';
import { KlipperFile, KlipperInclude } from '@/server/helpers/klipper-parser/types';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs and path
vi.mock('fs');
vi.mock('path', async () => {
	const actual = await vi.importActual('path');
	return {
		...actual,
		resolve: (p: string) => p, // Simplify resolve
		dirname: (p: string) => p.substring(0, p.lastIndexOf('/')),
		join: (a: string, b: string) => `${a}/${b}`.replace(/\/+/g, '/'),
		isAbsolute: (p: string) => p.startsWith('/'),
	};
});

describe('KlipperLoader', () => {
	let loader: KlipperLoader;

	beforeEach(() => {
		loader = new KlipperLoader();
		vi.resetAllMocks();
	});

	it('should load a simple file', async () => {
		const filePath = '/config/printer.cfg';
		const content = `
[printer]
kinematics: corexy
`;
		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'readFileSync').mockReturnValue(content);

		const file = await loader.load(filePath);
		
		expect(file.path).toBe(filePath);
		expect(file.content).toBe(content);
		expect(file.nodes).toHaveLength(2); // Empty line + Section
	});

	it('should resolve includes', async () => {
		const mainPath = '/config/printer.cfg';
		const mainContent = `
[include mainsail.cfg]
[printer]
`;
		const includePath = '/config/mainsail.cfg';
		const includeContent = `
[virtual_sdcard]
path: ~/printer_data/gcodes
`;

		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
			if (p === mainPath) return mainContent;
			if (p === includePath) return includeContent;
			return '';
		});

		const file = await loader.load(mainPath);
		
		const includeNode = file.nodes.find((n: any) => n.type === 'Include') as KlipperInclude;
		expect(includeNode).toBeDefined();
		expect(includeNode.path).toBe('mainsail.cfg');
		expect(includeNode.resolvedFile).toBeDefined();
		expect(includeNode.resolvedFile?.path).toBe(includePath);
		expect(includeNode.resolvedFile?.content).toBe(includeContent);
	});

	it('should handle circular includes gracefully', async () => {
		const fileA = '/config/a.cfg';
		const contentA = `[include b.cfg]`;
		const fileB = '/config/b.cfg';
		const contentB = `[include a.cfg]`;

		vi.spyOn(fs, 'existsSync').mockReturnValue(true);
		vi.spyOn(fs, 'readFileSync').mockImplementation((p) => {
			if (p === fileA) return contentA;
			if (p === fileB) return contentB;
			return '';
		});

		const file = await loader.load(fileA);
		
		const includeNodeA = file.nodes[0] as KlipperInclude;
		expect(includeNodeA.resolvedFile).toBeDefined();
		expect(includeNodeA.resolvedFile?.path).toBe(fileB);
		
		const includeNodeB = includeNodeA.resolvedFile?.nodes[0] as KlipperInclude;
		expect(includeNodeB).toBeDefined();
		// Circular reference should result in empty content/nodes for the repeated file
		expect(includeNodeB.resolvedFile).toBeDefined();
		expect(includeNodeB.resolvedFile?.content).toBe('');
		expect(includeNodeB.resolvedFile?.nodes).toHaveLength(0);
	});
});
