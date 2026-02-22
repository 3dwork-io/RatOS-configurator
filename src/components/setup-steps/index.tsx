import React, { useMemo, useEffect } from 'react';
import { useRecoilValue } from 'recoil';
import { ToolheadHelper } from '@/helpers/toolhead';
import { StepScreen, StepScreenProps } from '@/hooks/useSteps'; // We still use the types
import { LoadablePrinterToolheadsState } from '@/recoil/toolhead';
import { ToolheadConfiguration } from '@/zods/toolhead';
import { Spinner } from '@/components/common/spinner';
import { VerticalSteps } from '@/components/common/vertical-steps';
import dynamic from 'next/dynamic';
import { useSearchParams, useRouter } from 'next/navigation';

// Dynamic imports for wizard steps to improve initial load performance
const HardwareSelection = dynamic(() => import('@/components/setup-steps/hardware-selection').then(mod => mod.HardwareSelection), {
	loading: () => <Spinner />,
});
const MCUPreparation = dynamic(() => import('@/components/setup-steps/mcu-preparation').then(mod => mod.MCUPreparation), {
	loading: () => <Spinner />,
});
const PrinterSelection = dynamic(() => import('@/components/setup-steps/printer-selection').then(mod => mod.PrinterSelection), {
	loading: () => <Spinner />,
});
const WifiSetup = dynamic(() => import('@/components/setup-steps/wifi-setup').then(mod => mod.WifiSetup), {
	loading: () => <Spinner />,
});
const WizardComplete = dynamic(() => import('@/components/setup-steps/wizard-complete').then(mod => mod.WizardComplete), {
	loading: () => <Spinner />,
});

import { useLocalPathname } from '@/app/_hooks/navigation';
import { Card } from '@/components/common/card';
import { useMachine } from '@xstate/react';
import { createWizardMachine, WizardContext } from '@/machines/wizard-machine';

interface WizardProps {
	isConnectedToWifi?: boolean;
	hasWifiInterface?: boolean;
}

const makeSteps = (toolheads: ToolheadConfiguration<any>[], isConfigValid: boolean, hasWifiInterface?: boolean): StepScreen[] => {
	let nextIndex = 0;
	const getNextIndex = () => {
		const idx = nextIndex;
		nextIndex++;
		return (idx + '').padStart(2, '0');
	};
	const result: StepScreen[] = [];
	
	if (hasWifiInterface) {
		result.push({
			id: getNextIndex(),
			name: 'Network connectivity',
			description: 'Setup Wifi or Ethernet connectivity',
			href: '#',
			renderScreen: (screenProps) => <WifiSetup {...screenProps} key={screenProps.key} />,
		});
	}
	
	result.push({
			id: getNextIndex(),
			name: 'Printer Selection',
			description: 'Select the printer you want to configure',
			href: '#',
			renderScreen: (screenProps) => <PrinterSelection {...screenProps} key={screenProps.key} />,
		},
		{
			id: getNextIndex(),
			name: 'Control board preparation',
			canBeSkippedTo: isConfigValid,
			description: 'Connect to and flash your control board',
			href: '#',
			renderScreen: (screenProps) => <MCUPreparation {...screenProps} key={screenProps.key} />,
		},
	);
	
	toolheads.forEach((toolhead) => {
		const th = new ToolheadHelper(toolhead);
		result.push({
			id: getNextIndex(),
			name: `${th.getToolCommand()} Toolboard Preparation`,
			canBeSkippedTo: isConfigValid,
			description: `Connect to and flash an optional toolboard located on ${th.getDescription().toLocaleLowerCase()}`,
			href: '#',
			renderScreen: (screenProps) => (
				<MCUPreparation {...screenProps} key={screenProps.key} toolOrAxis={toolhead.axis} />
			),
		});
	});
	result.push({
		id: getNextIndex(),
		name: 'Hardware Selection',
		canBeSkippedTo: isConfigValid,
		description: 'Tell RatOS about that hardware you have installed on your printer',
		href: '#',
		renderScreen: (screenProps) => <HardwareSelection {...screenProps} key={screenProps.key} />,
	});
	result.push({
		id: getNextIndex(),
		name: 'Confirm your setup',
		canBeSkippedTo: isConfigValid,
		description: 'Confirm your setup and start printing',
		href: '#',
		renderScreen: (screenProps) => <WizardComplete {...screenProps} key={screenProps.key} />,
	});

	return result;
};

const LoadScreen: React.FC = () => {
	return (
		<div className="">
			<div className="mb-5 border-b border-zinc-200 pb-5 dark:border-zinc-700">
				<h3 className="text-lg font-medium leading-6 text-zinc-900 dark:text-zinc-100">
					Loading printer configuration...
				</h3>
				<p className="mt-2 max-w-4xl text-sm text-zinc-500 dark:text-zinc-400">
					Please wait while RatOS loads your printer configuration
				</p>
			</div>
			<div className="mt-4 flex h-48 items-center justify-center">
				<Spinner />
			</div>
		</div>
	);
};

export const SetupSteps: React.FC<WizardProps> = (props) => {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = useLocalPathname();
	const ths = useRecoilValue(LoadablePrinterToolheadsState);
	
	// Create machine
	const [state, send] = useMachine(
		useMemo(() => createWizardMachine({
			toolheads: ths,
			currentToolheadIndex: 0,
			isConfigValid: ths?.length > 0, // simplified validation check
			hasWifiInterface: !!props.hasWifiInterface,
			isConnectedToWifi: !!props.isConnectedToWifi,
		}), [ths, props.hasWifiInterface, props.isConnectedToWifi])
	);

	const steps = useMemo(() => makeSteps(ths, ths?.length > 0, props.hasWifiInterface), [ths, props.hasWifiInterface]);
	
	// Calculate current index based on state
	const currentStepIndex = useMemo(() => {
		let index = 0;
		if (state.matches('wifiSetup')) index = 0;
		else if (state.matches('printerSelection')) index = props.hasWifiInterface ? 1 : 0;
		else if (state.matches('mcuPreparation')) index = props.hasWifiInterface ? 2 : 1;
		else if (state.matches('toolboardPreparation')) {
			const base = props.hasWifiInterface ? 3 : 2;
			index = base + state.context.currentToolheadIndex;
		}
		else if (state.matches('hardwareSelection')) {
			const base = props.hasWifiInterface ? 3 : 2;
			index = base + ths.length;
		}
		else if (state.matches('confirm')) {
			const base = props.hasWifiInterface ? 4 : 3;
			index = base + ths.length;
		}
		return index;
	}, [state, props.hasWifiInterface, ths.length]);

	// Sync URL with step
	useEffect(() => {
		router.push(`${pathname}?step=${currentStepIndex}`, undefined);
	}, [currentStepIndex, pathname, router]);

	const currentStep = steps[currentStepIndex];

	const screenProps: StepScreenProps = {
		nextScreen: () => send({ type: 'NEXT' }),
		previousScreen: () => send({ type: 'PREV' }),
		hasNextScreen: true,
		hasPreviousScreen: currentStepIndex > 0,
		skipSteps: () => send({ type: 'NEXT' }), // Treat skip as next for now
		name: currentStep?.name as string,
		description: currentStep?.description as string,
		key: `step-${currentStepIndex}`,
	};

	const isReady = currentStep != null;

	return (
		<div className="mx-auto mt-8 grid max-w-3xl grid-cols-1 gap-4 px-4 lg:max-w-7xl lg:grid-flow-col-dense lg:grid-cols-3">
			<div className="lg:col-span-2 lg:col-start-1">
				<Card>
					<React.Suspense fallback={<LoadScreen />}>
						{isReady ? currentStep.renderScreen(screenProps) : <LoadScreen />}
					</React.Suspense>
				</Card>
			</div>
			<div className="space-y-6 lg:col-span-1 lg:col-start-3">
				<Card className="p-8">
					<div className="mb-5 border-b border-zinc-200 pb-5 dark:border-zinc-800">
						<h3 className="text-lg font-medium leading-6 text-zinc-900 dark:text-zinc-100">Setup Progress</h3>
					</div>
					<VerticalSteps
						steps={steps}
						screenProps={screenProps}
						currentStepIndex={currentStepIndex}
						setCurrentStepIndex={() => {}} // Disable manual navigation for now to enforce flow
					/>
				</Card>
			</div>
		</div>
	);
};
