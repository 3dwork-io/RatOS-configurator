import { setup, assign } from 'xstate';
import { ToolheadConfiguration } from '@/zods/toolhead';

export interface WizardContext {
  toolheads: ToolheadConfiguration<any>[];
  currentToolheadIndex: number;
  isConfigValid: boolean;
  hasWifiInterface: boolean;
  isConnectedToWifi: boolean;
}

export type WizardEvent =
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'GOTO'; stepId: string };

export const createWizardMachine = (context: WizardContext) => {
    return setup({
        types: {
            context: {} as WizardContext,
            events: {} as WizardEvent,
        },
        actions: {
            incrementToolhead: assign({
                currentToolheadIndex: ({ context }) => context.currentToolheadIndex + 1
            }),
            decrementToolhead: assign({
                currentToolheadIndex: ({ context }) => context.currentToolheadIndex - 1
            }),
            resetToolheadIndex: assign({
                currentToolheadIndex: 0
            }),
            setLastToolheadIndex: assign({
                currentToolheadIndex: ({ context }) => Math.max(0, context.toolheads.length - 1)
            })
        },
        guards: {
            hasMoreToolheads: ({ context }) => context.currentToolheadIndex < context.toolheads.length - 1,
            hasPreviousToolheads: ({ context }) => context.currentToolheadIndex > 0,
            hasWifi: ({ context }) => context.hasWifiInterface && !context.isConnectedToWifi,
            hasToolheads: ({ context }) => context.toolheads.length > 0,
        }
    }).createMachine({
        id: 'wizard',
        context,
        initial: 'init',
        states: {
            init: {
                always: [
                    { target: 'wifiSetup', guard: 'hasWifi' },
                    { target: 'printerSelection' }
                ]
            },
            wifiSetup: {
                tags: ['wifi'],
                meta: { stepName: 'Network connectivity', description: 'Setup Wifi or Ethernet connectivity' },
                on: {
                    NEXT: 'printerSelection'
                }
            },
            printerSelection: {
                tags: ['printer'],
                meta: { stepName: 'Printer Selection', description: 'Select the printer you want to configure' },
                on: {
                    NEXT: 'mcuPreparation',
                    PREV: [
                        { target: 'wifiSetup', guard: 'hasWifi' },
                        // If no wifi setup needed, we are at the start, so PREV does nothing or stays here
                    ]
                }
            },
            mcuPreparation: {
                tags: ['mcu'],
                meta: { stepName: 'Control board preparation', description: 'Connect to and flash your control board' },
                on: {
                    NEXT: [
                        { target: 'toolboardPreparation', guard: 'hasToolheads', actions: 'resetToolheadIndex' },
                        { target: 'hardwareSelection' }
                    ],
                    PREV: 'printerSelection'
                }
            },
            toolboardPreparation: {
                tags: ['toolboard'],
                initial: 'check',
                states: {
                    check: {
                        always: [
                            { target: 'configuring', guard: 'hasToolheads' },
                            { target: '#wizard.hardwareSelection' }
                        ]
                    },
                    configuring: {
                        meta: { stepName: 'Toolboard Preparation', description: 'Connect to and flash your toolboard' },
                        on: {
                            NEXT: [
                                { target: 'configuring', guard: 'hasMoreToolheads', actions: 'incrementToolhead' },
                                { target: '#wizard.hardwareSelection' }
                            ],
                            PREV: [
                                { target: 'configuring', guard: 'hasPreviousToolheads', actions: 'decrementToolhead' },
                                { target: '#wizard.mcuPreparation' }
                            ]
                        }
                    }
                }
            },
            hardwareSelection: {
                tags: ['hardware'],
                meta: { stepName: 'Hardware Selection', description: 'Tell RatOS about that hardware you have installed on your printer' },
                on: {
                    NEXT: 'confirm',
                    PREV: [
                        { target: 'toolboardPreparation.configuring', guard: 'hasToolheads', actions: 'setLastToolheadIndex' },
                        { target: 'mcuPreparation' }
                    ]
                }
            },
            confirm: {
                tags: ['confirm'],
                meta: { stepName: 'Confirm your setup', description: 'Confirm your setup and start printing' },
                on: {
                    PREV: 'hardwareSelection'
                }
            }
        }
    });
};
