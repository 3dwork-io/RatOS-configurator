import { KlipperSection, KlipperProperty } from './types';
import { KNOWN_HARDWARE } from './hardware_db';

export interface HardwareFingerprint {
	id: string;
	type: 'stepper' | 'driver' | 'hotend' | 'probe' | 'fan';
	features: Record<string, string | number | boolean>;
}

export interface MatchResult {
	fingerprint: HardwareFingerprint;
	confidence: number; // 0 to 1
	matchedFeatures: string[];
	mismatchedFeatures: string[];
}

/**
 * Extracts a feature vector from a Klipper section.
 * Flattens nested properties if necessary, but Klipper is mostly flat key-value.
 */
export function extractFeatures(section: KlipperSection): Record<string, string | number | boolean> {
	const features: Record<string, string | number | boolean> = {};

	for (const child of section.children) {
		if (child.type === 'Property') {
			const key = child.key;
			let value: string | number | boolean = child.value;

			// Attempt to parse numbers
			if (!isNaN(Number(value)) && value.trim() !== '') {
				value = Number(value);
			} else if (value.toLowerCase() === 'true') {
				value = true;
			} else if (value.toLowerCase() === 'false') {
				value = false;
			}

			features[key] = value;
		}
	}

	return features;
}

/**
 * Calculates the similarity between extracted features and a hardware fingerprint.
 * Uses a hybrid approach:
 * - Categorical features (strings, booleans) must match exactly or have high penalty.
 * - Numerical features (current, rotation_distance) use normalized distance.
 */
export function calculateSimilarity(
	features: Record<string, string | number | boolean>,
	fingerprint: HardwareFingerprint
): MatchResult {
	let matchScore = 0;
	let totalWeight = 0;
	const matchedFeatures: string[] = [];
	const mismatchedFeatures: string[] = [];

	const fpFeatures = fingerprint.features;

	for (const key in fpFeatures) {
		const expectedValue = fpFeatures[key];
		const actualValue = features[key];

		// Weight can be adjusted based on feature importance
		let weight = 1;
        if (key === 'rotation_distance' || key === 'microsteps') weight = 2;

		totalWeight += weight;

		if (actualValue === undefined) {
			// Feature missing in config, penalize slightly but don't kill match
            // unless it's a critical feature? For now, 0 score for missing.
            mismatchedFeatures.push(key);
			continue;
		}

		if (typeof expectedValue === 'string' || typeof expectedValue === 'boolean') {
			if (actualValue === expectedValue) {
				matchScore += weight;
				matchedFeatures.push(key);
			} else {
                mismatchedFeatures.push(key);
            }
		} else if (typeof expectedValue === 'number' && typeof actualValue === 'number') {
			// Calculate normalized distance
			const diff = Math.abs(expectedValue - actualValue);
			
            let isMatch = false;
            let isApprox = false;

            if (expectedValue === 0) {
                // For zero, use absolute tolerance
                if (diff < 0.001) isMatch = true;
            } else {
                const percentDiff = diff / Math.abs(expectedValue);
                if (percentDiff <= 0.05) isMatch = true;
                else if (percentDiff <= 0.15) isApprox = true;
            }

			if (isMatch) { // 5% tolerance
				matchScore += weight;
				matchedFeatures.push(key);
			} else if (isApprox) { // 15% tolerance
				matchScore += weight * 0.5;
                matchedFeatures.push(`${key} (approx)`);
			} else {
                mismatchedFeatures.push(key);
            }
		} else {
             mismatchedFeatures.push(key);
        }
	}
    
    // Normalize score
    const confidence = totalWeight > 0 ? matchScore / totalWeight : 0;

	return {
		fingerprint,
		confidence,
		matchedFeatures,
		mismatchedFeatures
	};
}

/**
 * Infers potential hardware matches for a given section.
 */
export function inferHardware(
	section: KlipperSection,
	candidates: HardwareFingerprint[]
): MatchResult[] {
	const features = extractFeatures(section);
	
	const results = candidates.map(candidate => calculateSimilarity(features, candidate));
    
    // Filter out low confidence matches and sort by confidence
    return results
        .filter(r => r.confidence > 0.4) // Threshold
        .sort((a, b) => b.confidence - a.confidence);
}

// --- Sample Fingerprints (Database) ---
// Imported from hardware_db.ts
export { KNOWN_HARDWARE };
