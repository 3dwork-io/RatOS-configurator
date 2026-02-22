import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { KlipperParser } from './index';
import { extractFeatures, HardwareFingerprint } from './inference';
import { KlipperSection } from './types';
import { getLogger } from '@/server/helpers/logger';

// Default path if env var is not set (useful for dev/tests)
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../../../configuration');

export class HardwareLoader {
	private configPath: string;

	constructor(configPath?: string) {
		let selectedPath = configPath;

        if (!selectedPath && process.env.RATOS_CONFIGURATION_PATH) {
            if (fs.existsSync(process.env.RATOS_CONFIGURATION_PATH)) {
                selectedPath = process.env.RATOS_CONFIGURATION_PATH;
            } else {
                console.warn(`Environment RATOS_CONFIGURATION_PATH "${process.env.RATOS_CONFIGURATION_PATH}" does not exist on disk.`);
            }
        }

        if (!selectedPath) {
            selectedPath = DEFAULT_CONFIG_PATH;
        }

        this.configPath = selectedPath;
	}

	public async loadHotends(): Promise<HardwareFingerprint[]> {
		const pattern = path.join(this.configPath, 'hotends', '*.cfg');
		// Handle windows backslashes in glob pattern if necessary, though glob usually handles forward slashes
		const files = await glob(pattern.replace(/\\/g, '/'));
		
		const fingerprints: HardwareFingerprint[] = [];

		for (const file of files) {
			try {
				const content = await fs.promises.readFile(file, 'utf-8');
				const parser = new KlipperParser(content);
				const nodes = parser.parse();
				
				// Extract ID from filename
				const id = path.basename(file, '.cfg');

				// Look for [extruder] section
				const extruderSection = nodes.find(n => n.type === 'Section' && n.name === 'extruder') as KlipperSection;
				
				if (extruderSection) {
					const features = extractFeatures(extruderSection);
					
					// Filter relevant features for fingerprinting
					// We only care about physical characteristics, not pins (which vary by board)
					const relevantFeatures: Record<string, string | number | boolean> = {};
					
					const keysToKeep = [
						'nozzle_diameter',
						'filament_diameter',
						'max_temp',
						'min_temp',
						'min_extrude_temp',
						'sensor_type',
						'pressure_advance',
						'control',
						'pid_Kp',
						'pid_Ki',
						'pid_Kd'
					];

					for (const key of keysToKeep) {
						if (key in features) {
							relevantFeatures[key] = features[key];
						}
					}

					fingerprints.push({
						id,
						type: 'hotend',
						features: relevantFeatures
					});
				}
			} catch (e) {
				console.warn(`Failed to parse hotend config: ${file}`, e);
			}
		}

		return fingerprints;
	}

	public async loadProbes(): Promise<HardwareFingerprint[]> {
		const pattern = path.join(this.configPath, 'z-probe', '*.cfg');
		const files = await glob(pattern.replace(/\\/g, '/'));
		
		const fingerprints: HardwareFingerprint[] = [];

		for (const file of files) {
			try {
				const content = await fs.promises.readFile(file, 'utf-8');
				const parser = new KlipperParser(content);
				const nodes = parser.parse();
				
				const id = path.basename(file, '.cfg');

				// Look for [probe] or [bltouch] or [beacon]
				// We need to iterate over sections to find the probe definition
				const probeSection = nodes.find(n => 
					n.type === 'Section' && 
					(n.name === 'probe' || n.name === 'bltouch' || n.name === 'beacon')
				) as KlipperSection;
				
				if (probeSection) {
					const features = extractFeatures(probeSection);
					
					// Keep relevant physical params
					const relevantFeatures: Record<string, string | number | boolean> = {};
					
					const keysToKeep = [
						'x_offset',
						'y_offset',
						'z_offset',
						'speed',
						'samples',
						'sample_retract_dist',
						'lift_speed',
						'samples_result',
						'samples_tolerance',
						'samples_tolerance_retries',
						'sensor_pin', // Sometimes relevant if specific like ^PC14
						'control_pin'
					];

					// Also keep the section name itself as a feature?
					// Yes, section name is a strong indicator (bltouch vs probe vs beacon)
					relevantFeatures['section_name'] = probeSection.name;

					for (const key of keysToKeep) {
						if (key in features) {
							relevantFeatures[key] = features[key];
						}
					}

					fingerprints.push({
						id,
						type: 'probe',
						features: relevantFeatures
					});
				}
			} catch (e) {
				console.warn(`Failed to parse probe config: ${file}`, e);
			}
		}

		return fingerprints;
	}
}
