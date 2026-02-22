import { ZodError, z } from 'zod';
import fs, { existsSync } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { TRPCError } from '@trpc/server';
import { runSudoScript } from '@/server/helpers/run-script';
import {
	BoardID,
	BoardWithDetectionStatus,
	ToolboardWithDetectionStatus,
	reversePinLookup,
} from '@/zods/boards';
import { middleware, publicProcedure, router } from '@/server/trpc';
import path from 'path';
import { glob } from 'glob';
import { SerializedToolheadConfiguration } from '@/zods/toolhead';
import { getBoardSerialPath } from '@/helpers/board';
import { serverSchema } from '@/env/schema.mjs';
import { getScriptRoot } from '@/server/helpers/file-operations';
import { ToolheadHelper } from '@/helpers/toolhead';
import { deserializeToolheadConfiguration } from '@/server/routers/printer';
import { PrinterAxis } from '@/zods/motion';
import { parseBoardPinConfig } from '@/server/helpers/metadata';
import { getLastPrinterSettings } from '@/server/helpers/printer-settings';
import { queryPrinterState } from '@/server/helpers/klipper';
import {
	compileFirmware,
	detect,
	detectDfuDevices,
	findUnidentifiedDevices,
	flashAllConnectedBoards,
	flashBoard,
	flashDfuDevice,
	getBoards,
	getBoardsWithDriverCount,
	getBoardsWithoutHost,
	getToolboards,
	queryBoardVersion,
	updateDetectionStatus,
} from '@/server/services/mcu';

const inputSchema = z.object({
	boardPath: z.string().optional(),
	toolhead: SerializedToolheadConfiguration.optional(),
	controlboard: BoardID.optional(),
});

const mcuMiddleware = middleware(async ({ ctx, next, meta, rawInput }) => {
	let boards = null;
	let toolhead = null;
	const parsedInput = inputSchema.safeParse(rawInput);
	try {
		boards = await getBoards();
		try {
			toolhead =
				parsedInput.success && parsedInput.data.toolhead
					? new ToolheadHelper(
							await deserializeToolheadConfiguration(
								parsedInput.data.toolhead,
								{ controlboard: parsedInput.data.controlboard },
								boards,
							),
						)
					: undefined;
			boards = await updateDetectionStatus(boards, toolhead);
		} catch (e) {
			if (e instanceof ZodError) {
				throw new TRPCError({
					code: 'INTERNAL_SERVER_ERROR',
					message: `Toolhead configuration cannot be deserialized, please check the configuration.\n${Object.entries(
						e.flatten().fieldErrors,
					)
						.map(([k, v]) => `${k}: ${v}`)
						.join('\n')}`,
					cause: e,
				});
			}
			throw new TRPCError({
				code: 'INTERNAL_SERVER_ERROR',
				message: `Toolhead configuration cannot be deserialized, please check the configuration.`,
				cause: e,
			});
		}
		if (meta?.includeHost !== true) {
			boards = getBoardsWithoutHost(boards);
		}
	} catch (e) {
		if (e instanceof TRPCError) {
			throw e;
		}
		throw new TRPCError({
			code: 'INTERNAL_SERVER_ERROR',
			message: `Invalid board definition(s) in ${process.env.RATOS_CONFIGURATION_PATH}/boards.`,
			cause: e,
		});
	}
	let board = null;

	if (meta?.boardRequired && (!parsedInput.success || parsedInput.data.boardPath == null)) {
		throw new TRPCError({
			code: 'PRECONDITION_FAILED',
			message: `boardPath parameter missing.`,
		});
	}
	if (parsedInput.success && parsedInput.data.boardPath != null) {
		board = boards.find((b) => b.path === parsedInput.data.boardPath);
		if (board == null) {
			throw new TRPCError({
				code: 'PRECONDITION_FAILED',
				message: `No supported board exists for the path ${parsedInput.data.boardPath}`,
			});
		}
	}
	return next({
		ctx: {
			...ctx,
			boards: boards,
			board: board,
			toolhead: toolhead,
		},
	});
});
const mcuProcedure = publicProcedure.use(mcuMiddleware);
export const mcuRouter = router({
	boards: mcuProcedure
		.input(
			z.object({
				boardFilters: z
					.object({
						toolboard: z.boolean().optional(),
						driverCountRequired: z.number().optional(),
					})
					.optional(),
				toolhead: SerializedToolheadConfiguration.optional(),
				controlboard: BoardID.optional(),
			}),
		)
		.output(z.array(BoardWithDetectionStatus))
		.query(({ ctx, input }) => {
			let boards = ctx.boards;
			if (input.boardFilters?.toolboard === true) {
				boards = getToolboards(boards);
			}
			if (input.boardFilters?.driverCountRequired != null) {
				boards = getBoardsWithDriverCount(boards, input.boardFilters.driverCountRequired);
			}
			return boards;
		}),
	detect: mcuProcedure
		.input(inputSchema)
		.meta({
			boardRequired: true,
		})
		.query(({ ctx, input }) => {
			if (ctx.board == null) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: `No supported board exists for the path ${input.boardPath}`,
				});
			}
			return detect(ctx.board, ctx.toolhead);
		}),
	unidentifiedDevices: mcuProcedure.input(inputSchema).query(async ({ ctx }) => {
		return await findUnidentifiedDevices(ctx.boards, ctx.toolhead);
	}),
	boardVersion: mcuProcedure
		.input(inputSchema)
		.meta({
			boardRequired: true,
		})
		.query(async ({ ctx, input }) => {
			if (ctx.board == null) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: `No supported board exists for the path ${input.boardPath}`,
				});
			}
			return await queryBoardVersion(ctx.board, ctx.toolhead);
		}),
	compile: mcuProcedure
		.input(
			z.object({
				boardPath: z.string(),
				toolhead: SerializedToolheadConfiguration.optional(),
			}),
		)
		.meta({
			boardRequired: true,
		})
		.mutation(async ({ ctx, input }) => {
			if (ctx.board == null) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: `No supported board exists for the path ${input.boardPath}`,
				});
			}
			await compileFirmware(ctx.board, ctx.toolhead);
			return 'success';
		}),
	reversePinLookup: mcuProcedure
		.meta({
			boardRequired: true,
		})
		.input(z.object({ axis: z.nativeEnum(PrinterAxis), canUseExtruderlessConfigs: z.boolean(), boardPath: z.string() }))
		.query(async ({ ctx, input }) => {
			if (ctx.board == null) {
				return undefined;
			}
			const isExtruderlessBoard = ctx.board.extruderlessConfig != null && input.canUseExtruderlessConfigs;
			const pins = await parseBoardPinConfig(ctx.board, isExtruderlessBoard);

			const axisAlias =
				input.axis === PrinterAxis.z
					? 'z0'
					: input.axis === PrinterAxis.extruder
						? 'e'
						: PrinterAxis.extruder1 === input.axis
							? 'e1'
							: input.axis;
			return (
				reversePinLookup(
					{
						step_pin: pins[`${axisAlias}_step_pin` as keyof typeof pins],
						dir_pin: pins[`${axisAlias}_dir_pin` as keyof typeof pins],
					},
					ctx.board,
				) ?? null
			);
		}),
	flashAllConnected: mcuProcedure
		.meta({
			boardRequired: false,
			includeHost: true,
		})
		.mutation(async ({ ctx }) => {
			return await flashAllConnectedBoards(ctx.boards);
		}),
	flashViaPath: mcuProcedure
		.input(
			z.object({
				boardPath: z.string(),
				flashPath: z.string().optional(),
				toolhead: SerializedToolheadConfiguration.optional(),
			}),
		)
		.meta({
			boardRequired: true,
		})
		.mutation(async ({ ctx, input }) => {
			if (ctx.board == null) {
				throw new TRPCError({
					code: 'PRECONDITION_FAILED',
					message: `No supported board exists for the path ${input.boardPath}`,
				});
			}
			return await flashBoard(ctx.board, input.flashPath, ctx.toolhead);
		}),
	dfuDetect: mcuProcedure
		.input(inputSchema)
		.meta({
			boardRequired: true,
		})
		.query(async ({ ctx, input }) => {
			return await detectDfuDevices();
		}),
	dfuFlash: mcuProcedure
		.input(inputSchema)
		.meta({
			boardRequired: true,
		})
		.mutation(async ({ ctx, input }) => {
			if (ctx.board == null) return; // middleware takes care of the error message.
			return await flashDfuDevice(ctx.board, ctx.toolhead);
		}),
});
