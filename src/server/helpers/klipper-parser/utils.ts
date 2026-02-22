import { KlipperNode, KlipperSection, KlipperProperty } from './types';

export function extractJsonFromComments(nodes: KlipperNode[]): string | null {
	const allNodes: KlipperNode[] = [];
	const traverse = (n: KlipperNode) => {
		allNodes.push(n);
		if (n.type === 'Section') {
			n.children.forEach(traverse);
		}
	};
	nodes.forEach(traverse);

	allNodes.sort((a, b) => a.range.start.line - b.range.start.line);

	let jsonLines: string[] = [];
	let insideJson = false;

	for (const node of allNodes) {
		if (node.type === 'Comment') {
			// Match sed behavior: start with "^# {" and end with "^# }"
            // The sed command is '/^# {/' and '/\n# }/'
            // This implies the block starts with a line that is exactly "# {" (or starts with it?)
            // sed regex matches start of line.
            
            const rawTrimmed = node.raw.trim();
            
			if (rawTrimmed.startsWith('# {')) {
				insideJson = true;
                // We should include the content of the start line.
                // If line is "# {", content is "{".
                // If line is "# { "foo": 1", content is '{ "foo": 1'.
                jsonLines.push(node.content);
                
                // If the same line also ends the block?
                // sed logic with 'N' and loop implies it looks for a *subsequent* line matching "# }".
                // But if the block is single line "# { ... }", sed might fail or loop forever if no "# }" found later?
                // Actually sed would read until end of file and print nothing if pattern not found?
                // Let's assume standard RatOS multi-line format.
                
			} else if (insideJson) {
                if (rawTrimmed.startsWith('# }')) {
                    insideJson = false;
                    jsonLines.push(node.content);
                    return jsonLines.join('\n');
                }
				jsonLines.push(node.content);
			}
		} else if (insideJson && node.type !== 'EmptyLine') {
			// If we hit a non-empty non-comment line inside the block, abort.
            insideJson = false;
            jsonLines = [];
		}
	}
	return null;
}

export function parsePinAliasFromAst(ast: KlipperNode[]): Record<string, string | undefined> {
	const sections = ast.filter(n => n.type === 'Section') as KlipperSection[];
	const boardPinSection = sections.find(s => s.name.startsWith('board_pins'));
	
	if (!boardPinSection) {
		throw new Error('Failed to find board pin section');
	}

	const aliasesProp = boardPinSection.children.find(n => n.type === 'Property' && n.key === 'aliases') as KlipperProperty;
	if (!aliasesProp) {
		throw new Error('Board pin aliases not found');
	}

	const value = aliasesProp.value;
    // Split by comma or newline.
	const parts = value.split(/[\n,]+/).map(p => p.trim()).filter(p => p !== '');
	
	const pins: Record<string, string | undefined> = {};
	
	parts.forEach(part => {
		if (!part.includes('=')) return;
		const [key, val] = part.split('=').map(s => s.trim());
		if (val === 'null' || (val.startsWith('<') && val.endsWith('>'))) {
			pins[key] = undefined;
		} else {
			pins[key] = val;
		}
	});
	
	return pins;
}

export function findSectionProperty(ast: KlipperNode[], sectionPrefix: string, propertyKey: string): string | null {
    const sections = ast.filter(n => n.type === 'Section') as KlipperSection[];
	const section = sections.find(s => s.name.startsWith(sectionPrefix));
    if (!section) return null;
    
    const prop = section.children.find(n => n.type === 'Property' && n.key === propertyKey) as KlipperProperty;
    return prop ? prop.value : null;
}
