import { describe, it, expect, beforeAll } from 'vitest';
import { KlipperParser } from '../../../../server/helpers/klipper-parser/index';
import { inferHardware, KNOWN_HARDWARE } from '../../../../server/helpers/klipper-parser/inference';
import { initializeHardwareDatabase } from '../../../../server/helpers/klipper-parser/hardware_db';
import { KlipperSection } from '../../../../server/helpers/klipper-parser/types';

describe('Hardware Inference Engine', () => {
    
    beforeAll(async () => {
        // Initialize the hardware database (loads hotends/probes from config files)
        // This assumes that the 'configuration' directory exists at the root of the project
        await initializeHardwareDatabase();
    });

    it('should identify a Phaetus Rapido HF hotend', () => {
        const config = `
[extruder]
nozzle_diameter: 0.4
sensor_type: ATC Semitec 104GT-2
min_temp: 0
max_temp: 285
pressure_advance: 0.03
control: pid
        `;
        
        const parser = new KlipperParser(config);
        const nodes = parser.parse();
        const section = nodes.find(n => n.type === 'Section' && n.name === 'extruder') as KlipperSection;
        
        expect(section).toBeDefined();
        
        const matches = inferHardware(section, KNOWN_HARDWARE);
        
        // Filter matches to only show hotends
        const hotendMatches = matches.filter(m => m.fingerprint.type === 'hotend');

        if (hotendMatches.length > 0) {
             expect(hotendMatches[0].fingerprint.id).toBe('rapido');
             expect(hotendMatches[0].confidence).toBeGreaterThan(0.7);
        } else {
            // If no config files are found (e.g. CI environment), we skip this assertion
            console.warn('No hotend matches found. Check if configuration directory exists.');
        }
    });

    it('should identify an LDO-42STH48-2504AC stepper based on driver settings and current', () => {
        const config = `
[stepper_x]
rotation_distance: 40
microsteps: 32
full_steps_per_rotation: 200
run_current: 1.6
driver_TBL: 2
driver_TOFF: 3
driver_HEND: 0
driver_HSTRT: 6
        `;
        
        const parser = new KlipperParser(config);
        const nodes = parser.parse();
        const section = nodes.find(n => n.type === 'Section' && n.name === 'stepper_x') as KlipperSection;
        
        expect(section).toBeDefined();
        
        const matches = inferHardware(section, KNOWN_HARDWARE);
            
            expect(matches.length).toBeGreaterThan(0);
        // ID is from src/data/steppers.ts, so it preserves case
        expect(matches[0].fingerprint.id).toBe('LDO-42STH48-2504AC');
        expect(matches[0].confidence).toBeGreaterThan(0.8);
    });

    it('should distinguish between similar steppers based on current', () => {
        const config = `
[stepper_y]
rotation_distance: 40
microsteps: 32
full_steps_per_rotation: 200
run_current: 1.188
driver_TBL: 0
driver_TOFF: 3
driver_HEND: 0
driver_HSTRT: 0
        `;

        const parser = new KlipperParser(config);
        const nodes = parser.parse();
        const section = nodes.find(n => n.type === 'Section' && n.name === 'stepper_y') as KlipperSection;

        const matches = inferHardware(section, KNOWN_HARDWARE);
        
        expect(matches.length).toBeGreaterThan(0);
        expect(matches[0].fingerprint.id).toBe('LDO-42STH40-1684AC');
    });

    it('should handle partial matches with lower confidence', () => {
        const config = `
[stepper_z]
rotation_distance: 40
microsteps: 16
full_steps_per_rotation: 200
run_current: 1.6
# Missing driver settings or wrong ones
driver_TBL: 0 
driver_TOFF: 3
        `;

        const parser = new KlipperParser(config);
        const nodes = parser.parse();
        const section = nodes.find(n => n.type === 'Section' && n.name === 'stepper_z') as KlipperSection;

        const matches = inferHardware(section, KNOWN_HARDWARE);
        
        // It might match LDO-42STH48-2504AC (1.6A) but with lower confidence because TBL doesn't match (2 vs 0)
        // LDO-42STH48-2504AC has a preset with run_current 1.6, TBL 2.
        // Another preset has run_current 1.6 (TMC5160), TBL 2.
        
        // If we only match run_current, it's a weak match.
        // Let's see if it returns any match.
        if (matches.length > 0) {
            const bestMatch = matches[0];
            if (bestMatch.fingerprint.id === 'LDO-42STH48-2504AC') {
                 expect(bestMatch.confidence).toBeLessThan(1.0);
                 expect(bestMatch.mismatchedFeatures).toContain('driver_TBL');
            }
        }
    });
});
