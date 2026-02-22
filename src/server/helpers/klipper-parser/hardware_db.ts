import { HardwareFingerprint } from './inference';
import { Steppers } from '@/data/steppers';
import { HardwareLoader } from './hardware-loader';
import { getLogger } from '@/server/helpers/logger';

class HardwareRegistry {
    private byType: Map<string, HardwareFingerprint[]> = new Map();
    private all: HardwareFingerprint[] = [];

    public add(fp: HardwareFingerprint) {
        this.all.push(fp);
        if (!this.byType.has(fp.type)) {
            this.byType.set(fp.type, []);
        }
        this.byType.get(fp.type)!.push(fp);
    }

    public getAll(): HardwareFingerprint[] {
        return this.all;
    }

    public getByType(type: HardwareFingerprint['type']): HardwareFingerprint[] {
        return this.byType.get(type) || [];
    }

    public findCandidates(features: Record<string, string | number | boolean>): HardwareFingerprint[] {
        // Optimization: Filter by type if possible based on features
        // For example, if features has 'nozzle_diameter', it's likely a hotend.
        // If it has 'rotation_distance', it's a stepper/extruder.
        
        if (features['nozzle_diameter'] !== undefined || features['filament_diameter'] !== undefined) {
            return this.getByType('hotend');
        }
        if (features['x_offset'] !== undefined || features['y_offset'] !== undefined || features['z_offset'] !== undefined) {
            return this.getByType('probe');
        }
        if (features['rotation_distance'] !== undefined || features['microsteps'] !== undefined) {
            // Could be stepper or extruder (which is a stepper in Klipper terms for motion)
            return this.getByType('stepper');
        }
        
        return this.all;
    }
}

export const HARDWARE_REGISTRY = new HardwareRegistry();
export const KNOWN_HARDWARE: HardwareFingerprint[] = HARDWARE_REGISTRY.getAll(); // Backward compatibility

let isInitialized = false;

export const initializeHardwareDatabase = async () => {
    if (isInitialized) return;

    try {
        const loader = new HardwareLoader();
        const hotends = await loader.loadHotends();
        const probes = await loader.loadProbes();
        
        hotends.forEach(h => HARDWARE_REGISTRY.add(h));
        probes.forEach(p => HARDWARE_REGISTRY.add(p));
        
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
            if (preset.driver_TBL !== undefined) features['driver_TBL'] = preset.driver_TBL;
            if (preset.driver_TOFF !== undefined) features['driver_TOFF'] = preset.driver_TOFF;
            if (preset.driver_HEND !== undefined) features['driver_HEND'] = preset.driver_HEND;
            if (preset.driver_HSTRT !== undefined) features['driver_HSTRT'] = preset.driver_HSTRT;
            if ('driver_IHOLDDELAY' in preset && preset.driver_IHOLDDELAY !== undefined) features['driver_IHOLDDELAY'] = preset.driver_IHOLDDELAY;
            if ('driver_TPOWERDOWN' in preset && preset.driver_TPOWERDOWN !== undefined) features['driver_TPOWERDOWN'] = preset.driver_TPOWERDOWN;
            if ('driver_PWM_FREQ' in preset && preset.driver_PWM_FREQ !== undefined) features['driver_PWM_FREQ'] = preset.driver_PWM_FREQ;
            if ('driver_PWM_GRAD' in preset && preset.driver_PWM_GRAD !== undefined) features['driver_PWM_GRAD'] = preset.driver_PWM_GRAD;
            if ('driver_PWM_AMPL' in preset && preset.driver_PWM_AMPL !== undefined) features['driver_PWM_AMPL'] = preset.driver_PWM_AMPL;
            if ('driver_PWM_AUTOSCALE' in preset && preset.driver_PWM_AUTOSCALE !== undefined) features['driver_PWM_AUTOSCALE'] = preset.driver_PWM_AUTOSCALE;
            
            // Add stepper specific features
            if (stepper.fullStepsPerRotation) features['full_steps_per_rotation'] = stepper.fullStepsPerRotation;
            
            HARDWARE_REGISTRY.add({
                id: stepper.id,
                type: 'stepper',
                features
            });
        });
    }
});
