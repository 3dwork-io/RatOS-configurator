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
	private currentLineIdx: number = 0;
	private cursor: number = 0;

	constructor(content: string) {
		this.content = content;
	}

	private getNextLine(): string | null {
		if (this.cursor >= this.content.length && this.cursor > 0) return null; // End of content, allow empty string if content is empty? No, cursor > 0 check handles non-empty content end.
		// Edge case: empty content string -> cursor 0, length 0. Should return one empty line?
		// split('') -> [''] (length 1).
		if (this.content.length === 0 && this.cursor === 0) {
			this.cursor = 1;
			return '';
		}
		if (this.cursor >= this.content.length) return null;

		let end = this.content.indexOf('\n', this.cursor);
		if (end === -1) {
			const line = this.content.substring(this.cursor);
			this.cursor = this.content.length + 1; // Ensure we don't return again
			return line.endsWith('\r') ? line.slice(0, -1) : line;
		}
		
		let lineEnd = end;
		if (end > this.cursor && this.content[end - 1] === '\r') {
			lineEnd = end - 1;
		}

		const line = this.content.substring(this.cursor, lineEnd);
		this.cursor = end + 1;
		return line;
	}

	public parse(): KlipperNode[] {
		this.currentLineIdx = 0;
		this.cursor = 0;
		const nodes: KlipperNode[] = [];
		let currentSection: KlipperSection | null = null;
		
		let line: string | null;
		while ((line = this.getNextLine()) !== null) {
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
						args = content.substring(spaceIndex + 1).trim();
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
			
			// 4. Property
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
				const valuePart = line.substring(actualSeparatorIndex + 1);
				
				// Inline comment handling
				let finalValue = valuePart;
				let inlineComment: string | undefined = undefined;

				// Find comment start
				const commentMatch = valuePart.match(/[\s]([#;].*)$/);
				if (commentMatch && commentMatch.index !== undefined) {
					finalValue = valuePart.substring(0, commentMatch.index);
					inlineComment = commentMatch[1].substring(1).trim();
				}

				const propNode: KlipperProperty = {
					type: 'Property',
					key,
					value: finalValue.trim(),
					inlineComment,
					range,
					raw: line,
				};

				if (currentSection) {
					currentSection.children.push(propNode);
				} else {
					const orphanNode: KlipperComment = {
						type: 'Comment',
						content: "ORPHAN PROPERTY: " + trimmedLine,
						range,
						raw: line
					};
					nodes.push(orphanNode);
				}
				this.currentLineIdx++;
				continue;
			}

			// 5. Unknown / Continuation
			// If it's indented and we have a previous property, it's a continuation.
			if ((line.startsWith(' ') || line.startsWith('\t')) && currentSection && currentSection.children.length > 0) {
				const lastChild = currentSection.children[currentSection.children.length - 1];
				if (lastChild.type === 'Property') {
					lastChild.value += '\n' + trimmedLine;
					lastChild.raw += '\n' + line;
					lastChild.range.end = endPos;
					this.currentLineIdx++;
					continue;
				}
			}

			// Otherwise, it's unknown/comment
			const unknownNode: KlipperComment = {
				type: 'Comment',
				content: trimmedLine, // Treat as comment content
				range,
				raw: line
			};
			if (currentSection) {
				currentSection.children.push(unknownNode);
			} else {
				nodes.push(unknownNode);
			}
			this.currentLineIdx++;
		}
		return nodes;
	}
}
