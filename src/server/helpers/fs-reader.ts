import fs from 'fs';
import { promisify } from 'util';

const open = promisify(fs.open);
const read = promisify(fs.read);
const close = promisify(fs.close);
const stat = promisify(fs.stat);
const readFile = promisify(fs.readFile);

/**
 * Utility that can tail/head a file.
 * Positive line number means head, negative means tail, 0 or null means whole.
 *
 * @param file string that says where file is located & its name
 * @param lines number of lines to read (negative will do tail, 0 or null will read whole file)
 */
export async function getLines(file: string, lines: number | null | undefined): Promise<string> {
	const stats = await stat(file);
	if (!lines) {
		return (await readFile(file)).toString();
	}

	const fileSize = stats.size;
	if (fileSize <= 0) return '';

	const bufferSize = 1024 * 64;
	let data = '';
	let position: number;

	let getRemainingFileSize: () => number;
	let getReadStartPosition: (bufferLen: number) => number;
	let getNextNewline: (str: string) => number;
	let getRestOfStringPos: (str: string) => number;
	let recordAndGetLeftoverData: (newData: string, snipPos: number) => string;
	let updatePosition: (bufferLen: number) => void;
	let addMoreNoticeToFile: (data: string) => string;

	if (lines > 0) {
		// head
		position = 0;
		getRemainingFileSize = () => fileSize - position;
		getReadStartPosition = () => position;
		getNextNewline = (str) => str.indexOf('\n');
		getRestOfStringPos = (str) => str.length;
		recordAndGetLeftoverData = (newData, snipPos) => {
			data += newData.substring(0, snipPos + 1);
			return newData.substring(snipPos + 1);
		};
		updatePosition = (bufferLen) => {
			position += bufferLen;
		};
		addMoreNoticeToFile = (d) => d + '<<< more >>> ...';
	} else {
		// tail
		lines = -lines;
		position = fileSize;
		getRemainingFileSize = () => position;
		getReadStartPosition = (bufferLen) => position - bufferLen;
		getNextNewline = (str) => str.lastIndexOf('\n');
		getRestOfStringPos = () => 0;
		recordAndGetLeftoverData = (newData, snipPos) => {
			data = newData.substring(snipPos) + data;
			return newData.substring(0, snipPos);
		};
		updatePosition = (bufferLen) => {
			position -= bufferLen;
		};
		addMoreNoticeToFile = (d) => '... <<< more >>>' + d;
	}

	let readLinesCount = 0;
	const fd = await open(file, 'r');

	try {
		while (true) {
			const length = getRemainingFileSize();
			if (length <= 0) {
				return data;
			}

			const bytesToRead = bufferSize > length ? length : bufferSize;
			const buffer = Buffer.alloc(bytesToRead);
			const { bytesRead } = await read(fd, buffer, 0, bytesToRead, getReadStartPosition(bytesToRead));
			
            // Update buffer to actual bytes read if for some reason it's different (though unlikely with exact calculation)
            let newData = buffer.toString('utf8', 0, bytesRead);

			do {
				let snipPos = getNextNewline(newData);
				if (snipPos >= 0) {
					readLinesCount++;
				} else {
					snipPos = getRestOfStringPos(newData);
				}

				newData = recordAndGetLeftoverData(newData, snipPos);
			} while (readLinesCount < lines && newData.length > 0);

			if (readLinesCount < lines) {
				updatePosition(bytesRead);
			} else {
				return addMoreNoticeToFile(data);
			}
		}
	} finally {
		await close(fd);
	}
}

export default getLines;
