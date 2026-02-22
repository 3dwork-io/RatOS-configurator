import {
	KlipperComment,
	KlipperEmptyLine,
	KlipperInclude,
	KlipperNode,
	KlipperProperty,
	KlipperSection,
	Position,
	Range,
	SectionChild,
} from './types';

export class KlipperParser {
	private content: string;
	private lines: string[];
	private currentLineIdx: number = 0;

	constructor(content: string) {
		this.content = content;
		this.lines = content.split(/\r?\n/);
	}

	public parse(): KlipperNode[] {
		this.currentLineIdx = 0;
		const nodes: KlipperNode[] = [];
		let currentSection: KlipperSection | null = null;

		while (this.currentLineIdx < this.lines.length) {
			const line = this.lines[this.currentLineIdx];
			const trimmedLine = line.trim();
			
			const startPos: Position = {
				line: this.currentLineIdx,
				column: 0,
				offset: 0, 
			};
			const endPos: Position = {
				line: this.currentLineIdx,
				column: line.length,
				offset: line.length,
			};
			const range: Range = { start: startPos, end: endPos };

			// 1. Empty Line
			if (trimmedLine === '') {
				const emptyNode: KlipperEmptyLine = {
					type: 'EmptyLine',
					range,
					raw: line,
				};
				if (currentSection) {
					currentSection.children.push(emptyNode);
				} else {
					nodes.push(emptyNode);
				}
				this.currentLineIdx++;
				continue;
			}

			// 2. Comment (Start of line)
			if (trimmedLine.startsWith('#') || trimmedLine.startsWith(';')) {
				const commentNode: KlipperComment = {
					type: 'Comment',
					content: trimmedLine.substring(1).trim(),
					range,
					raw: line,
				};
				if (currentSection) {
					currentSection.children.push(commentNode);
				} else {
					nodes.push(commentNode);
				}
				this.currentLineIdx++;
				continue;
			}

			// 3. Section Header or Include
			if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
				const content = trimmedLine.slice(1, -1).trim();
				
				if (content.startsWith('include ')) {
					const includePath = content.substring(8).trim();
					const includeNode: KlipperInclude = {
						type: 'Include',
						path: includePath,
						range,
						raw: line,
					};
					
					if (currentSection) {
						currentSection.children.push(includeNode);
					} else {
						nodes.push(includeNode);
					}
				} else {
					const spaceIndex = content.indexOf(' ');
					let name = content;
					let args: string | undefined = undefined;
					
					if (spaceIndex > -1) {
						name = content.substring(0, spaceIndex);
						args = content.substring(spaceIndex + 1);
					}

					currentSection = {
						type: 'Section',
						name,
						args,
						children: [],
						range,
						raw: line,
					};
					nodes.push(currentSection);
				}
				this.currentLineIdx++;
				continue;
			}

			// 4. Continuation (Indented line)
			if (line.startsWith(' ') || line.startsWith('\t')) {
				const contextChildren = currentSection ? currentSection.children : nodes;
				// Find last property to append to
				let lastProp: KlipperProperty | null = null;
				// Iterate backwards skipping comments/empty lines to find the property
				for (let i = contextChildren.length - 1; i >= 0; i--) {
					const node = contextChildren[i];
					if (node.type === 'Property') {
						lastProp = node;
						break;
					}
					if (node.type === 'Section') break; 
				}

				if (lastProp) {
					// We append the raw line to value (stripping initial indentation? No, usually value includes indentation or we strip it)
					// Klipper values usually strip the indentation when parsed, but for AST we might want to keep it or normalize.
					// Let's keep it raw in `raw` and normalized in `value`.
					lastProp.value += '\n' + trimmedLine;
					lastProp.raw += '\n' + line;
					lastProp.range.end.line = this.currentLineIdx;
					this.currentLineIdx++;
					continue;
				}
				
				// Orphan indent
				const orphanNode: KlipperComment = {
					type: 'Comment',
					content: "ORPHAN INDENT: " + trimmedLine,
					range,
					raw: line
				};
				if (currentSection) currentSection.children.push(orphanNode);
				else nodes.push(orphanNode);
				this.currentLineIdx++;
				continue;
			}

			// 5. Property
			const separatorIndex = line.indexOf(':');
			const separatorIndexEq = line.indexOf('=');
			
			let actualSeparatorIndex = -1;
			if (separatorIndex !== -1 && separatorIndexEq !== -1) {
				actualSeparatorIndex = Math.min(separatorIndex, separatorIndexEq);
			} else if (separatorIndex !== -1) {
				actualSeparatorIndex = separatorIndex;
			} else {
				actualSeparatorIndex = separatorIndexEq;
			}
			
			if (actualSeparatorIndex !== -1) {
				const key = line.substring(0, actualSeparatorIndex).trim();
				let valuePart = line.substring(actualSeparatorIndex + 1);
				
				// Check for inline comment
				// Heuristic: " #" or " ;" or "#" at start of value (if empty value?)
				// But we trimmed key, so value starts after separator.
				
				// We need to be careful not to split inside quotes (if Klipper supports quotes? It doesn't really, strings are just strings).
				// But Klipper does support inline comments.
				
				const commentRegex = /[\s]([#;].*)$/;
				const match = valuePart.match(commentRegex);
				
				let inlineComment: string | null = null;
				let finalValue = valuePart;

				if (match && match.index !== undefined) {
					// match[0] is " # comment" (including space)
					// match[1] is "# comment"
					inlineComment = match[1].substring(1).trim();
					finalValue = valuePart.substring(0, match.index);
				}

				const propNode: KlipperProperty = {
					type: 'Property',
					key,
					value: finalValue.trim(),
					inlineComment: inlineComment ? inlineComment.trim() : undefined,
					range,
					raw: line,
				};

				if (currentSection) {
					currentSection.children.push(propNode);
					if (inlineComment) {
						// Add comment node after property
						const commentNode: KlipperComment = {
							type: 'Comment',
							content: inlineComment.substring(1).trim(), // remove #
							range: { ...range, start: { ...range.start, column: actualSeparatorIndex + 1 + finalValue.length } }, // Approx pos
							raw: inlineComment // This is not the full line, but the comment part. 
                            // Actually `raw` should probably be the full line for reconstruction?
                            // But here we split one line into two nodes.
                            // If we reconstruct, we might double print.
                            // Maybe `PropertyNode` should have `inlineComment` field after all?
                            // It's cleaner for reconstruction.
						};
                        // For now, let's just NOT add a separate comment node to avoid duplication in `raw`.
                        // We will store the value trimmed. The `raw` field of property has the full line.
					}
				} else {
					nodes.push(propNode);
				}
				this.currentLineIdx++;
				continue;
			}

			// 6. Unknown
			const unknownNode: KlipperComment = {
				type: 'Comment',
				content: "UNKNOWN: " + trimmedLine,
				range,
				raw: line
			};
			if (currentSection) currentSection.children.push(unknownNode);
			else nodes.push(unknownNode);
			this.currentLineIdx++;
		}

		return nodes;
	}
}
