import { HardwareFingerprint } from './inference';
import { Steppers } from '@/data/steppers';
import { HardwareLoader } from './hardware-loader';
import { getLogger } from '@/server/helpers/logger';

export const KNOWN_HARDWARE: HardwareFingerprint[] = [];

let isInitialized = false;

export const initializeHardwareDatabase = async () => {
    if (isInitialized) return;

    try {
        const loader = new HardwareLoader();
        const hotends = await loader.loadHotends();
        const probes = await loader.loadProbes();
        
        KNOWN_HARDWARE.push(...hotends);
        KNOWN_HARDWARE.push(...probes);
        
        getLogger().info(`Initialized Hardware DB with ${hotends.length} hotends and ${probes.length} probes.`);
        isInitialized = true;
    } catch (e) {
        getLogger().error('Failed to initialize hardware database from config files', e);
    }
};

// Generate fingerprints from Steppers (synchronous part)
Steppers.forEach(stepper => {
    if (stepper.presets) {
        stepper.presets.forEach(preset => {
            const features: Record<string, string | number | boolean> = {};
            
            // Extract features from preset
            if (preset.run_current) features['run_current'] = preset.run_current;
            // The driver field in preset is the type (e.g. TMC2209), which is useful for filtering
            // but might not appear as a property in the config unless we look at the section name.
            // However, specific driver settings (driver_TBL, etc) are strong indicators.
            
            if ('sense_resistor' in preset) features['sense_resistor'] = preset.sense_resistor;
            if ('driver_TBL' in preset) features['driver_TBL'] = preset.driver_TBL;
            if ('driver_TOFF' in preset) features['driver_TOFF'] = preset.driver_TOFF;
            if ('driver_HEND' in preset) features['driver_HEND'] = preset.driver_HEND;
            if ('driver_HSTRT' in preset) features['driver_HSTRT'] = preset.driver_HSTRT;
            if ('driver_IHOLDDELAY' in preset) features['driver_IHOLDDELAY'] = preset.driver_IHOLDDELAY;
            if ('driver_TPOWERDOWN' in preset) features['driver_TPOWERDOWN'] = preset.driver_TPOWERDOWN;
            if ('driver_PWM_FREQ' in preset) features['driver_PWM_FREQ'] = preset.driver_PWM_FREQ;
            if ('driver_PWM_GRAD' in preset) features['driver_PWM_GRAD'] = preset.driver_PWM_GRAD;
            if ('driver_PWM_AMPL' in preset) features['driver_PWM_AMPL'] = preset.driver_PWM_AMPL;
            if ('driver_PWM_AUTOSCALE' in preset) features['driver_PWM_AUTOSCALE'] = preset.driver_PWM_AUTOSCALE;
            
            // Add stepper specific features
            if (stepper.fullStepsPerRotation) features['full_steps_per_rotation'] = stepper.fullStepsPerRotation;
            
            KNOWN_HARDWARE.push({
                id: stepper.id,
                type: 'stepper',
                features
            });
        });
    }
});
