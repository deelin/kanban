const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const READ_TIMEOUT_MS = 8_000;

export interface TerminalImage {
	data: string;
	mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
	size: number;
}

// The File System Access API is not declared by every supported TS DOM lib.
interface DroppedFileHandle {
	kind: string;
	getFile(): Promise<File>;
}

interface FileHandleItem extends DataTransferItem {
	getAsFileSystemHandle?: () => Promise<DroppedFileHandle | null>;
}

export interface ImageSource {
	file: File | null;
	handle?: Promise<DroppedFileHandle | null> | null;
	entry?: FileSystemEntry | null;
}

function safely<T>(read: () => T): T | null {
	try {
		return read();
	} catch {
		return null;
	}
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = READ_TIMEOUT_MS): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error("Timed out reading the dropped image.")), timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

// Capture ALL accessors synchronously. Browsers protect the drag store after
// event dispatch, even when macOS is still fulfilling a screenshot file promise.
export function captureImageSources(transfer: DataTransfer, isDrop: boolean): ImageSource[] {
	const sources: ImageSource[] = [];
	for (const item of Array.from(transfer.items || []) as FileHandleItem[]) {
		if (item.kind !== "file") continue;
		sources.push({
			file: safely(() => item.getAsFile()),
			handle:
				isDrop && item.getAsFileSystemHandle
					? Promise.resolve(safely(() => item.getAsFileSystemHandle?.())).then(
							(handle) => handle ?? null,
							() => null,
						)
					: null,
			entry: isDrop ? safely(() => item.webkitGetAsEntry()) : null,
		});
	}
	if (!sources.length) {
		for (const file of Array.from(transfer.files || [])) sources.push({ file });
	}
	return sources;
}

function sniffType(bytes: Uint8Array): TerminalImage["mimeType"] | null {
	if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return "image/png";
	if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
	if (/^GIF8[79]a$/.test(String.fromCharCode(...bytes.slice(0, 6)))) return "image/gif";
	if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
		return "image/webp";
	return null;
}

async function fileToImage(file: File): Promise<TerminalImage> {
	if (file.size > MAX_IMAGE_BYTES) throw new RangeError("Images must be 20 MB or smaller.");
	if (!file.size) throw new Error("The screenshot is not ready yet.");
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!bytes.length) throw new Error("The screenshot is not ready yet.");
	const mimeType = sniffType(bytes);
	if (!mimeType) throw new RangeError("Use a PNG, JPEG, GIF, or WebP image.");
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 32768) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
	}
	return { data: btoa(binary), mimeType, size: bytes.length };
}

async function readSource(source: ImageSource): Promise<TerminalImage> {
	let lastError: unknown = new Error(
		"macOS did not provide a readable image. Save the screenshot, then drag it here.",
	);
	for (const wait of [0, 100, 250, 500, 1000, 2000]) {
		if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
		// Prefer the captured File when readable. A pending handle must not block
		// clipboard/virtual files that already expose their bytes.
		const readers: Array<() => Promise<File | null>> = [async () => source.file];
		if (source.handle) {
			const pendingHandle = source.handle;
			readers.push(async () => {
				const handle = await withTimeout(pendingHandle, 500);
				return handle?.kind === "file" ? handle.getFile() : null;
			});
		}
		if (source.entry?.isFile) {
			const entry = source.entry as FileSystemFileEntry;
			readers.push(() => new Promise((resolve, reject) => entry.file(resolve, reject)));
		}
		for (const read of readers) {
			try {
				const file = await withTimeout(read(), 500);
				if (file) return await withTimeout(fileToImage(file), 1000);
			} catch (error) {
				if (error instanceof RangeError) throw error;
				lastError = error;
			}
		}
	}
	throw lastError;
}

export function readImages(sources: ImageSource[]): Promise<TerminalImage[]> {
	return Promise.all(sources.map((source) => withTimeout(readSource(source))));
}
