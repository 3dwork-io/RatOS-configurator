import { describe, it, expect } from 'vitest';
import { KlipperParser } from '@/server/helpers/klipper-parser/index';
import { KlipperSection, KlipperProperty, KlipperInclude } from '@/server/helpers/klipper-parser/types';

describe('KlipperParser', () => {
	it('should parse a simple section with properties', () => {
		const content = `
[stepper_x]
step_pin: PA1
dir_pin: !PA2
rotation_distance: 40
`;
		const parser = new KlipperParser(content);
		const ast = parser.parse();

		// Filter out empty lines for easier testing
		const meaningfulNodes = ast.filter(n => n.type !== 'EmptyLine');

		expect(meaningfulNodes).toHaveLength(1);
		const section = meaningfulNodes[0] as KlipperSection;
		expect(section.type).toBe('Section');
		expect(section.name).toBe('stepper_x');
		
		const props = section.children.filter(n => n.type === 'Property') as KlipperProperty[];
		expect(props).toHaveLength(3);
		expect(props[0].key).toBe('step_pin');
		expect(props[0].value).toBe('PA1');
	});

	it('should handle includes correctly', () => {
		const content = `
[include mainsail.cfg]
[printer]
kinematics: corexy
`;
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		
		const meaningfulNodes = ast.filter(n => n.type !== 'EmptyLine');
		
		// First node should be Include
		const includeNode = meaningfulNodes[0] as KlipperInclude;
		expect(includeNode.type).toBe('Include');
		expect(includeNode.path).toBe('mainsail.cfg');
		
		// Second node should be Section
		const sectionNode = meaningfulNodes[1] as KlipperSection;
		expect(sectionNode.type).toBe('Section');
		expect(sectionNode.name).toBe('printer');
	});

	it('should handle inline comments', () => {
		const content = `
[extruder]
nozzle_diameter: 0.4 # Standard nozzle
pressure_advance: 0.05 ; comment with semicolon
`;
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		const section = ast.find(n => n.type === 'Section') as KlipperSection;
		const props = section.children.filter(n => n.type === 'Property') as KlipperProperty[];
		
		expect(props[0].value).toBe('0.4');
		expect(props[0].inlineComment).toBe('Standard nozzle');
		expect(props[1].value).toBe('0.05');
		expect(props[1].inlineComment).toBe('comment with semicolon');
	});

	it('should handle multiline values (indentation)', () => {
		const content = `
[gcode_macro START_PRINT]
gcode:
  G28
  G1 Z10
`;
		const parser = new KlipperParser(content);
		const ast = parser.parse();
		const section = ast.find(n => n.type === 'Section') as KlipperSection;
		const prop = section.children.find(n => n.type === 'Property') as KlipperProperty;
		
		expect(prop.key).toBe('gcode');
		// Value should contain newlines
		expect(prop.value).toContain('G28');
		expect(prop.value).toContain('G1 Z10');
	});
});
