import fs, { existsSync, readFileSync } from 'fs';
import { glob } from 'glob';
import path from 'path';
import { TRPCError } from '@trpc/server';
import { copyFile, unlink } from 'fs/promises';
import { promisify } from 'util';
import { execFile } from 'child_process';
import {
	AutoFlashableBoard,
	Board,
	BoardPath,
	BoardWithDetectionStatus,
	ToolboardWithDetectionStatus,
} from '@/zods/boards';
import { getBoardSerialPath, getBoardChipId } from '@/helpers/board';
import { serverSchema } from '@/env/schema.mjs';
import { replaceInFileByLine, getScriptRoot } from '@/server/helpers/file-operations';
import { ToolheadHelper } from '@/helpers/toolhead';
import { ServerCache } from '@/server/helpers/cache';
import { runSudoScript } from '@/server/helpers/run-script';
import { queryPrinterState } from '@/server/helpers/klipper';
import { getLastPrinterSettings } from '@/server/helpers/printer-settings';
import { z } from 'zod';

export const detect = (board: Board, toolhead?: ToolheadHelper<boolean>) => {
	return fs.existsSync(getBoardSerialPath(board, toolhead));
};

export const getBoards = async () => {
	const cached = ServerCache.get('boards');
	if (cached != null && cached.length > 0) {
		return cached.map((b) => {
			b.detected = detect(b);
			return b;
		});
	}
	const defs = await glob(`${process.env.RATOS_CONFIGURATION_PATH}/boards/*/board-definition.json`);
	const boards = defs
		.map((f) =>
			f.trim() === ''
				? null
				: {
						...(JSON.parse(fs.readFileSync(f).toString()) as BoardWithDetectionStatus),
						path: BoardPath.parse(f.replace('board-definition.json', '')),
					},
		)
		.filter(Boolean)
		.map((b) => {
			b.detected = detect(b);
			try {
				return BoardWithDetectionStatus.parse(b);
			} catch (e) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: `Invalid board definition for ${b.name} in ${b.path}`,
					cause: e,
				});
			}
		});
	ServerCache.set('boards', boards);
	return boards;
};

export const updateDetectionStatus = async (boards: BoardWithDetectionStatus[], toolhead?: ToolheadHelper<boolean>) => {
	return boards.map((b) => {
		b.detected = detect(b, toolhead);
		return b;
	});
};

export const compileFirmware = async <T extends boolean>(
	board: Board,
	toolhead?: ToolheadHelper<boolean> | null,
	skipCompile?: T,
): Promise<T extends true ? string : Awaited<ReturnType<typeof runSudoScript>>> => {
	let compileResult = null;
	const environment = serverSchema.parse(process.env);
	try {
		const dest = path.join(environment.KLIPPER_DIR, '.config');
		await copyFile(path.join(board.path, 'firmware.config'), dest);
		if (!board.isHost) {
			await replaceInFileByLine(
				dest,
				/CONFIG_USB_SERIAL_NUMBER=".+"/g,
				`CONFIG_USB_SERIAL_NUMBER="${getBoardChipId(board, toolhead)}"`,
			);
		}
		if (skipCompile) {
			return readFileSync(dest).toString() as T extends true ? string : Awaited<ReturnType<typeof runSudoScript>>;
		}
		const binaryName = board.firmwareBinaryName;
		let extension = path.extname(binaryName);
		if (extension === '.hex' && board.firmwareBinaryName.endsWith('.elf.hex')) {
			extension = '.elf.hex';
		}
		const klipperOut = path.join(environment.KLIPPER_DIR, 'out', `klipper${extension}`);
		const firmwareDest = path.join(environment.RATOS_DATA_DIR, binaryName);
		existsSync(firmwareDest) && (await unlink(firmwareDest));
		compileResult = await runSudoScript('klipper-compile.sh');
		if (existsSync(klipperOut)) {
			await copyFile(klipperOut, firmwareDest);
		} else if (!board.isHost) {
			throw new Error(`Could not find compiled firmware at ${klipperOut}`);
		}
		return compileResult as T extends true ? string : Awaited<ReturnType<typeof runSudoScript>>;
	} catch (e) {
		const message = e instanceof Error ? e.message : e;
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Could not compile firmware for ${board.name}: ${message} \n\n ${compileResult?.stdout}`,
			cause: e,
		});
	}
};

export const getBoardsWithoutHost = (boards: BoardWithDetectionStatus[]) => {
	return boards.filter((b) => !b.isHost);
};

export const getToolboards = (boards: BoardWithDetectionStatus[]) => {
	return z.array(ToolboardWithDetectionStatus).parse(boards.filter((b) => b.isToolboard));
};

export const getBoardsWithDriverCount = (boards: BoardWithDetectionStatus[], driverCount: number) => {
	return boards.filter(
		(b) => b.driverCount >= driverCount || (b.extruderlessConfig != null && b.driverCount >= driverCount - 1),
	);
};

export const findUnidentifiedDevices = async (boards: BoardWithDetectionStatus[], toolhead?: ToolheadHelper<boolean>) => {
	const detected = boards
		.filter((b) => b.detected)
		.map((b) => fs.realpathSync(getBoardSerialPath(b, toolhead)));
	return (await glob('/dev/serial/by-id/usb-Klipper*')).filter((d) => !detected.includes(fs.realpathSync(d)));
};

export const queryBoardVersion = async (board: Board, toolhead?: ToolheadHelper<boolean>) => {
	if (process.env.KLIPPER_ENV == null || process.env.KLIPPER_ENV.trim() === '') {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `Environment variable KLIPPER_ENV is missing`,
		});
	}
	if (process.env.KLIPPER_DIR == null || process.env.KLIPPER_DIR.trim() === '') {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `Environment variable KLIPPER_DIR is missing`,
		});
	}
	const printerState = await queryPrinterState();
	if (!['error', 'complete', 'canceled', 'standby', undefined].includes(printerState)) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `Printer is busy, board cannot be queried at this time without interrupting operations. Klipper print state reported as "${printerState}".`,
		});
	}

	const scriptRoot = getScriptRoot();
	let version = { stdout: '' };
	let error: unknown = null;
	try {
		await fetch('http://127.0.0.1:7125/machine/services/stop?service=klipper', { method: 'POST' });
		version = await promisify(execFile)(
			path.join(process.env.KLIPPER_ENV, 'bin', 'python'),
			[path.join(scriptRoot, 'check-version.py'), getBoardSerialPath(board, toolhead)],
			{ env: { KLIPPER_DIR: process.env.KLIPPER_DIR, NODE_ENV: process.env.NODE_ENV } },
		);
	} catch (e) {
		error = e;
	} finally {
		await fetch('http://127.0.0.1:7125/machine/services/start?service=klipper', { method: 'POST' });
	}
	if (error) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			cause: error,
		});
	}
	const versionRegEx = /Version:\s(v\d+\.\d+\.\d+-\d+-\w+)/;
	return version.stdout.match(versionRegEx)?.[1];
};

export const flashAllConnectedBoards = async (boards: BoardWithDetectionStatus[]) => {
	const config = await getLastPrinterSettings();
	const toolheadHelpers = config.toolheads.map((t) => {
		return new ToolheadHelper(t);
	});
	const connectedBoards: { board: Board; toolhead: ToolheadHelper<boolean> | null }[] = boards
		.flatMap((b) => {
			if (b.flashScript && b.compileScript && b.disableAutoFlash !== true) {
				if (detect(b)) {
					return { board: b, toolhead: null } as { board: Board; toolhead: ToolheadHelper<boolean> | null };
				}
				const toolboards = toolheadHelpers
					.map((th) => {
						if (detect(b, th)) {
							return { board: b, toolhead: th } as { board: Board; toolhead: ToolheadHelper<boolean> | null };
						}
						return null;
					})
					.filter(Boolean);
				return toolboards;
			}
			return null;
		})
		.filter(Boolean);
	const flashResults: {
		board: Board;
		result: 'success' | 'error';
		message: string;
	}[] = [];
	for (const b of connectedBoards) {
		try {
			const current = AutoFlashableBoard.parse(b.board);
			await compileFirmware(b.board, b.toolhead);
			let flashResult = null;
			try {
				const flashScript = path.join(
					current.path.replace(`${process.env.RATOS_CONFIGURATION_PATH}/boards/`, ''),
					current.flashScript,
				);
				flashResult = b.toolhead
					? await runSudoScript('flash-path.sh', getBoardSerialPath(b.board, b.toolhead))
					: await runSudoScript('board-script.sh', flashScript);
			} catch (e) {
				const message = e instanceof Error ? e.message : e;
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: `Could not flash firmware to ${b.board.name}: \n\n ${flashResult?.stdout ?? message}`,
					cause: e,
				});
			}
			flashResults.push({
				board: b.board,
				result: 'success',
				message: `${b.board.manufacturer} ${b.board.name} on ${b.toolhead ? ` ${b.toolhead.getToolCommand()}` : ''} was successfully flashed.`,
			});
		} catch (e) {
			const message = e instanceof Error ? e.message : e;
			flashResults.push({
				board: b.board,
				result: 'error',
				message:
					typeof message === 'string'
						? message
						: `Unknown error occured while flashing ${b.board.manufacturer} ${b.board.name} on ${b.toolhead ? ` ${b.toolhead.getToolCommand()}` : ''}`,
			});
		}
	}
	const successCount = flashResults.filter((r) => r.result === 'success').length;
	let report = `${successCount}/${connectedBoards.length} connected board(s) flashed successfully.\n`;
	flashResults.map((r) => {
		if (r.result === 'error') {
			report += `${r.board.manufacturer} ${r.board.name} failed to flash: ${r.message}\n`;
		} else {
			report += `${r.board.manufacturer} ${r.board.name} was successfully flashed.\n`;
		}
	});
	return { report, flashResults };
};

export const flashBoard = async (board: BoardWithDetectionStatus, flashPath?: string, toolhead?: ToolheadHelper<boolean>) => {
	if (board.flashScript == null) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `${board.name} does not support automatic flashing via serial path.`,
		});
	}
	if (flashPath && !fs.existsSync(flashPath)) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `The path ${flashPath} does not exist.`,
		});
	}
	await compileFirmware(board, toolhead);
	let flashResult = null;
	try {
		const flashScript = path.join(
			board.path.replace(`${process.env.RATOS_CONFIGURATION_PATH}/boards/`, ''),
			board.flashScript,
		);
		flashResult = flashPath
			? await runSudoScript('flash-path.sh', getBoardSerialPath(board, toolhead), flashPath)
			: toolhead
				? await runSudoScript('flash-path.sh', getBoardSerialPath(board, toolhead))
				: await runSudoScript('board-script.sh', flashScript);
	} catch (e) {
		const message = e instanceof Error ? e.message : e;
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Could not flash firmware to ${board.name}: \n\n ${flashResult?.stdout ?? message}`,
			cause: e,
		});
	}
	return 'success';
};

export const detectDfuDevices = async () => {
	const { stdout } = await promisify(execFile)('lsusb');
	const dfuDeviceCount = stdout.split('\n').filter((line) => line.includes('0483:df11')).length;
	if (dfuDeviceCount === 1) {
		return true;
	}
	if (dfuDeviceCount > 1) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'Multiple DFU devices detected, please disconnect the other devices.',
		});
	}
	return false;
};

export const flashDfuDevice = async (board: Board, toolhead?: ToolheadHelper<boolean>) => {
	if (board.dfu == null) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: 'Board does not support DFU.',
		});
	}
	try {
		await compileFirmware(board, toolhead);
	} catch (e) {
		const message = e instanceof Error ? e.message : e;
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Could not compile firmware for ${board.name}: \n\n ${message}`,
			cause: e,
		});
	}
	try {
		const flashResult = await runSudoScript('dfu-flash.sh', getBoardSerialPath(board, toolhead));
		return flashResult.stdout;
	} catch (e) {
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: 'Failed to flash device',
			cause: e,
		});
	}
};
