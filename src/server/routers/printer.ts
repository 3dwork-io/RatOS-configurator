import { z } from 'zod';
import { Hotend, Extruder, Probe, thermistors, Endstop, Fan, Accelerometer } from '@/zods/hardware';
import { PrinterDefinitionWithResolvedToolheads } from '@/zods/printer';
import {
	SerializedPartialPrinterConfiguration,
	SerializedPrinterConfiguration,
} from '@/zods/printer-configuration';
import {
	SerializedToolheadConfiguration,
	ToolheadConfiguration,
	ToolOrAxis,
} from '@/zods/toolhead';
import { xEndstopOptions, yEndstopOptions } from '@/data/endstops';
import { serverSchema } from '@/env/schema.mjs';
import { controllerFanOptions, hotendFanOptions, partFanOptions } from '@/data/fans';
import { xAccelerometerOptions, yAccelerometerOptions } from '@/data/accelerometers';
import path from 'path';
import { publicProcedure, router } from '@/server/trpc';
import {
	extractToolheadFromPrinterConfiguration,
	extractToolheadsFromPrinterConfiguration,
	stringToTitleObject,
} from '@/utils/serialization';
import { QueryLike, RouterLike } from '@trpc/react-query/shared';
import { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import { ToolheadHelper } from '@/helpers/toolhead';
import { getLastPrinterSettings } from '@/server/helpers/printer-settings';
import { klipperRestart } from '@/server/helpers/klipper';
import { getScriptRoot } from '@/server/helpers/file-operations';
import { runSudoScript } from '@/server/helpers/run-script';
import {
	parseDirectory,
	serializedPartialConfigFromPrinterDefinition,
	deserializeToolheadConfiguration,
	getPrinters,
	isPrinterCfgInitialized,
	deserializePartialPrinterConfiguration,
	deserializePrinterConfiguration,
	compareSettings,
	regenerateKlipperConfiguration,
	generateKlipperConfiguration,
} from '@/server/services/configuration';

const getToolhead = async <
	S extends boolean = false,
	R = S extends true ? SerializedPartialPrinterConfiguration : ToolheadHelper<boolean>,
>(
	config: SerializedPartialPrinterConfiguration | null,
	toolOrAxis: ToolOrAxis,
	serialize?: S,
): Promise<null | R> => {
	const th =
		extractToolheadFromPrinterConfiguration(toolOrAxis, await deserializePartialPrinterConfiguration(config ?? {})) ??
		null;
	if (th == null) {
		return null;
	}
	if (serialize === true) {
		return th.serialize() as R;
	}
	return th as R;
};

const getToolheads = async <
	S extends boolean = false,
	R = S extends true ? SerializedPartialPrinterConfiguration : ToolheadHelper<boolean>,
>(
	config: SerializedPartialPrinterConfiguration | null,
	serialize?: S,
): Promise<null | R[]> => {
	const toolheads =
		extractToolheadsFromPrinterConfiguration(await deserializePartialPrinterConfiguration(config ?? {})) ?? null;
	if (toolheads == null) {
		return null;
	}
	if (serialize === true) {
		return toolheads.map((th) => th.serialize() as R);
	}
	return toolheads as R[];
};

export const printerRouter = router({
	getSavedConfig: publicProcedure.output(SerializedPrinterConfiguration.nullable()).query(async (ctx) => {
		const config = await getLastPrinterSettings(undefined, true);
		return config;
	}),
	getSavedPrinterName: publicProcedure.output(z.string().nullable()).query(async (ctx) => {
		const config = await getLastPrinterSettings(undefined, true);
		const printer = (await getPrinters()).find((p) => p.id === config.printer);
		if (printer == null) {
			return null;
		}
		return printer.manufacturer + ' ' + printer.name;
	}),
	printers: publicProcedure
		.output(z.array(PrinterDefinitionWithResolvedToolheads))
		.query(async () =>
			(await getPrinters(true)).sort((a, b) =>
				a.manufacturer === 'Rat Rig' && (b.manufacturer !== 'Rat Rig' || b.description.indexOf('Discontinued') > -1)
					? -1
					: a.name.localeCompare(b.name),
			),
		),
	printer: publicProcedure
		.input(z.string())
		.output(PrinterDefinitionWithResolvedToolheads.nullable())
		.query(async (ctx) => {
			const printer = (await getPrinters()).find((p) => p.id === ctx.input);
			if (printer) {
				const resolvedToolheads = await Promise.all(
					printer.defaults.toolheads.map((th) =>
						deserializeToolheadConfiguration(th, serializedPartialConfigFromPrinterDefinition(printer)),
					),
				);
				const printerWithResolvedToolheads = {
					...printer,
					defaults: {
						...printer.defaults,
						toolheads: resolvedToolheads,
					},
				};
				return PrinterDefinitionWithResolvedToolheads.parse(printerWithResolvedToolheads);
			} else {
				return null;
			}
		}),
	hotends: publicProcedure.output(z.array(Hotend)).query(() => parseDirectory('hotends', Hotend)),
	extruders: publicProcedure.output(z.array(Extruder)).query(() => parseDirectory('extruders', Extruder)),
	probes: publicProcedure.output(z.array(Probe)).query(() => parseDirectory('z-probe', Probe)),
	thermistors: publicProcedure.query(() => thermistors.map(stringToTitleObject)),
	xEndstops: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Endstop))
		.query(async (ctx) =>
			xEndstopOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	yEndstops: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Endstop))
		.query(async (ctx) =>
			yEndstopOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	partFanOptions: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Fan))
		.query(async (ctx) =>
			partFanOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	hotendFanOptions: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Fan))
		.query(async (ctx) =>
			hotendFanOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	controllerFanOptions: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
			}),
		)
		.output(z.array(Fan))
		.query(async (ctx) =>
			controllerFanOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolheads(ctx.input.config))?.map((th) => th.getConfig()),
			),
		),
	xAccelerometerOptions: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Accelerometer))
		.query(async (ctx) =>
			xAccelerometerOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	yAccelerometerOptions: publicProcedure
		.input(
			z.object({
				config: SerializedPartialPrinterConfiguration.nullable(),
				toolOrAxis: ToolOrAxis,
			}),
		)
		.output(z.array(Accelerometer))
		.query(async (ctx) =>
			yAccelerometerOptions(
				await deserializePartialPrinterConfiguration(ctx.input.config ?? {}),
				(await getToolhead(ctx.input.config, ctx.input.toolOrAxis))?.getConfig(),
			),
		),
	deserializeToolheadConfiguration: publicProcedure
		.input(
			z.object({
				config: SerializedToolheadConfiguration,
				printerConfig: SerializedPartialPrinterConfiguration.optional(),
			}),
		)
		.query(async (ctx) => {
			return await deserializeToolheadConfiguration(ctx.input.config, ctx.input.printerConfig ?? {});
		}),
	printercfgStatus: publicProcedure.query(async () => {
		return {
			isInitialized: await isPrinterCfgInitialized(),
		};
	}),
	regenerateConfiguration: publicProcedure
		.input(z.object({ overwriteFiles: z.array(z.string()).optional(), skipFiles: z.array(z.string()).optional() }))
		.mutation(async ({ input }) => {
			const res = await regenerateKlipperConfiguration(undefined, input.overwriteFiles, input.skipFiles);
			if (res.some((r) => r.action === 'created' || r.action === 'overwritten')) {
				klipperRestart();
			}
			return res;
		}),
	// Has to be a mutation as printer config is too large for url string.
	getFilesToWrite: publicProcedure
		.input(
			z.object({
				config: SerializedPrinterConfiguration,
			}),
		)
		.mutation(async (ctx) => {
			const { config: serializedConfig } = ctx.input;
			return await compareSettings(serializedConfig);
		}),
	saveConfiguration: publicProcedure
		.input(
			z.object({
				config: SerializedPrinterConfiguration,
				overwriteFiles: z.array(z.string()).optional(),
				skipFiles: z.array(z.string()).optional(),
			}),
		)
		.mutation(async (ctx) => {
			const { config: serializedConfig, overwriteFiles, skipFiles } = ctx.input;
			const config = await deserializePrinterConfiguration(serializedConfig);
			const configResult = await generateKlipperConfiguration(config, overwriteFiles, skipFiles);
			klipperRestart();
			return configResult;
		}),
	flashBeacon: publicProcedure.mutation(async () => {
		const environment = serverSchema.parse(process.env);
		const res = await runSudoScript(
			path.relative(getScriptRoot(), path.join(environment.RATOS_CONFIGURATION_PATH, 'scripts', 'beacon-update.sh')),
		);
		if (res.stderr) {
			throw new Error(res.stderr);
		}
		return res.stdout;
	}),
});

export type PrinterRouterLike = RouterLike<typeof printerRouter>;
type HardwareQueries = Pick<
	PrinterRouterLike,
	| 'extruders'
	| 'controllerFanOptions'
	| 'hotendFanOptions'
	| 'hotends'
	| 'partFanOptions'
	| 'probes'
	| 'thermistors'
	| 'xAccelerometerOptions'
	| 'xEndstops'
	| 'yAccelerometerOptions'
	| 'yEndstops'
>;
export type DropdownQueryKeys = keyof HardwareQueries;
export type DropdownQuery<T extends DropdownQueryKeys = DropdownQueryKeys> = QueryLike<(typeof printerRouter)[T]>;
export type DropdownQueryInput<T extends DropdownQueryKeys = DropdownQueryKeys> = inferRouterInputs<
	typeof printerRouter
>[T];
export type DropdownQueryOutput<T extends DropdownQueryKeys = DropdownQueryKeys> = inferRouterOutputs<
	typeof printerRouter
>[T];
