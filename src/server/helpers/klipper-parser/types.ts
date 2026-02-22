export interface Position {
	line: number;
	column: number;
	offset: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface KlipperNodeBase {
	type: string;
	range: Range;
	raw: string;
}

export type SectionChild = KlipperProperty | KlipperInclude | KlipperComment | KlipperEmptyLine;

export interface KlipperSection extends KlipperNodeBase {
	type: 'Section';
	name: string;
	args?: string;
	children: SectionChild[];
}

export interface KlipperProperty extends KlipperNodeBase {
	type: 'Property';
	key: string;
	value: string;
	inlineComment?: string;
}

export interface KlipperInclude extends KlipperNodeBase {
	type: 'Include';
	path: string;
	resolvedFile?: KlipperFile;
}

export interface KlipperComment extends KlipperNodeBase {
	type: 'Comment';
	content: string;
}

export interface KlipperEmptyLine extends KlipperNodeBase {
	type: 'EmptyLine';
}

export type KlipperNode =
	| KlipperSection
	| KlipperProperty // For top-level properties (rare but possible)
	| KlipperInclude
	| KlipperComment
	| KlipperEmptyLine;

export interface KlipperFile {
	path: string;
	nodes: KlipperNode[];
	content: string;
}
