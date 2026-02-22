import { createReadStream, existsSync, readFileSync } from 'fs';
import path from 'path';
import { createInterface } from 'readline';
import { z, ZodType } from 'zod';
import { serverSchema } from '@/env/schema.mjs';
import {
	Board,
	ControlBoardPinMap,
	ExtruderlessControlBoardPinMap,
	PinMap,
	Toolboard,
	ToolboardPinMap,
} from '@/zods/boards';
import { Extruder } from '@/zods/hardware';
import { getScriptRoot } from '@/server/helpers/file-operations';
import { getLogger } from '@/server/helpers/logger';
import { MetadataCache, cacheAsyncMetadataFn, cacheMetadataFn } from '@/server/helpers/cache';
import { KlipperParser } from './klipper-parser';
import { extractJsonFromComments, findSectionProperty, parsePinAliasFromAst } from './klipper-parser/utils';

export const parseMetadata = async <T extends ZodType>(cfgFile: string, zod: T): Promise<z.infer<T> | null> => {
	if (cfgFile.trim() === '') return null;
	if (!existsSync(cfgFile)) return null;

	try {
		const content = readFileSync(cfgFile, 'utf-8');
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		
		const jsonStr = extractJsonFromComments(ast);
		if (jsonStr == null) {
			return null;
		}

		const jsonContent = JSON.parse(jsonStr) as { path: string; id: string };
		jsonContent.path = cfgFile;
		const fileName = path.basename(cfgFile);
		if (fileName == null || fileName === '') {
			throw new Error("File name couldn't be parsed from path: " + cfgFile);
		}
		jsonContent.id = fileName.replace(/\.cfg$/g, '');
		return zod.parse(jsonContent);
	} catch (e: unknown) {
		if (e instanceof Error) {
			getLogger().error(e.message);
		}
		throw new Error(
			'Failed to parse JSON from file: ' +
				cfgFile +
				(e && typeof e === 'object' && 'message' in e ? '\n' + e.message : ''),
		);
	}
};

const parsePinValue = (value: string) => {
	if (value === 'null') {
		return undefined;
	}
	if (value.startsWith('<') && value.endsWith('>')) {
		return undefined;
	}
	return value;
};

const parsePinAlias = cacheAsyncMetadataFn(
	async (file: string) => {
		if (!existsSync(file)) {
			throw new Error('Failed to parse config file: ' + file);
		}
		
		const content = readFileSync(file, 'utf-8');
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		
		try {
			return parsePinAliasFromAst(ast);
		} catch (e) {
			if (e instanceof Error) {
				 throw new Error(e.message + ' in file: ' + file);
			}
			 throw new Error('Failed to parse pin alias in file: ' + file);
		}
	},
	'parsePinAlias',
	MetadataCache,
);

export const exportBoardPinAlias = (pinAlias: string, pins: z.infer<typeof PinMap>, mcu?: string) => {
	const aliases = (Object.keys(pins) as Array<keyof typeof pins>).map((k, i) => {
		if (pins[k] == null) {
			return k + '=null';
		}
		return k + '=' + pins[k];
	});
	// todoc fix motor pins from rail config
	const result = [`[board_pins ${pinAlias}]`];
	if (mcu != null) {
		result.push(`mcu: ${mcu}`);
	}
	result.push(`aliases:`, `\t${aliases.join(',\n\t')}`);
	return result.join('\n');
};

export type ToolboardPins<B> = B extends true ? ToolboardPinMap : null;
export type ControlPins<B> = B extends true ? ExtruderlessControlBoardPinMap : ControlBoardPinMap;
export type PinMapZodFromBoard<TBoard extends boolean, TExtruderLess> = TBoard extends true
	? ToolboardPins<TBoard>
	: ControlPins<TExtruderLess>;

export const parseBoardPinConfig = async <IsToolboard extends boolean, TExtruderLess extends boolean>(
	board: IsToolboard extends true ? Toolboard : Board,
	extruderLess?: TExtruderLess,
): Promise<PinMapZodFromBoard<IsToolboard, TExtruderLess>> => {
	let file = path.join(
		board.path,
		board.isToolboard
			? 'toolboard-config.cfg'
			: extruderLess && board.extruderlessConfig != null
				? board.extruderlessConfig
				: 'config.cfg',
	);
	const zod = board.isToolboard ? ToolboardPinMap : extruderLess ? ExtruderlessControlBoardPinMap : ControlBoardPinMap;
	return zod.parse(await parsePinAlias(file)) as PinMapZodFromBoard<IsToolboard, TExtruderLess>;
};

export const extractMcuFromFirmwareConfig = cacheAsyncMetadataFn(
	async (filePath: string) => {
		if (!existsSync(filePath)) {
			throw new Error('Firmware config file does not exist: ' + filePath);
		}
		const fileStream = createReadStream(filePath);

		const rl = createInterface({
			input: fileStream,
			crlfDelay: Infinity,
		});
		const startOfMCULine = `CONFIG_MCU="`;
		for await (const line of rl) {
			// Each line in input.txt will be successively available here as `line`.
			if (line.startsWith(startOfMCULine)) {
				return line.substring(startOfMCULine.length, line.length - 2);
			}
		}
		throw new Error('Failed to find MCU in firmware config file: ' + filePath);
	},
	'extractMcuFromFirmwareConfig',
	MetadataCache,
);

export const getExtruderRotationDistance = cacheMetadataFn(
	(extruderId: z.infer<(typeof Extruder)['shape']['id']>) => {
		const environment = serverSchema.parse(process.env);
		const extruderCfgPath = path.join(environment.RATOS_CONFIGURATION_PATH, 'extruders', extruderId + '.cfg');
		
		if (!existsSync(extruderCfgPath)) {
			throw new Error('Failed to parse config file: ' + extruderCfgPath);
		}
		
		const content = readFileSync(extruderCfgPath, 'utf-8');
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		
		const val = findSectionProperty(ast, 'extruder', 'rotation_distance');
		
		if (val == null) {
			throw new Error('Failed to find extruder rotation distance');
		}
		return parseFloat(val);
	},
	'getExtruderRotationDistance',
	MetadataCache,
);

export const readInclude = (fileName: string) => {
	const environment = serverSchema.parse(process.env);
	const fullPath = path.join(environment.RATOS_CONFIGURATION_PATH, fileName);
	if (!existsSync(fullPath)) {
		throw new Error("Included file doesn't exist: " + fileName);
	}
	return readFileSync(fullPath, 'utf-8');
};
export const stripIncludes = (content: string) => {
	return stripLinesStartingWith(content, '[include');
};
export const extractIncludes = (content: string) => {
	return extractLinesStartingWith(content, '[include');
};
export const stripCommentLines = (content: string) => {
	return stripLinesStartingWith(content, '#');
};
export const stripLinesStartingWith = (content: string, start: string) => {
	return content
		.split('\n')
		.filter((l) => !l.trim().startsWith(start))
		.join('\n');
};
export const extractLinesStartingWith = (content: string, start: string) => {
	return content
		.split('\n')
		.filter((l) => l.trim().startsWith(start))
		.join('\n');
};
export const stripDriverSections = (content: string) => {
	let insideDriverSection = false;
	return content
		.split('\n')
		.map((l) => {
			if (l.trim().startsWith('[tmc')) {
				insideDriverSection = true;
			}
			if (insideDriverSection) {
				if (l.trim().startsWith('[')) {
					insideDriverSection = false;
				} else {
					return null;
				}
			}
			return l;
		})
		.filter((l) => l != null)
		.join('\n');
};
export const replaceLinesStartingWith = (content: string, start: string, replace: string | null) => {
	return content
		.split('\n')
		.map((l) => (l.trim().startsWith(start) ? replace : l))
		.filter((l) => l !== null)
		.join('\n');
};
