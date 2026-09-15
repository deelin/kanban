// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { captureImageSources, readImages } from "@/terminal/terminal-image-transfer";

const png = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=",
	"base64",
);
const file = () => new File([png], "Screenshot.png", { type: "image/png" });

describe("terminal image transfer", () => {
	it("captures every promised file handle during synchronous event dispatch", async () => {
		let active = true;
		const getHandle = vi.fn(() => {
			expect(active).toBe(true);
			return Promise.resolve({ kind: "file", getFile: async () => file() });
		});
		const transfer = {
			items: [1, 2].map(() => ({ kind: "file", getAsFile: () => null, getAsFileSystemHandle: getHandle })),
			files: [],
		} as unknown as DataTransfer;
		const sources = captureImageSources(transfer, true);
		active = false;
		expect(getHandle).toHaveBeenCalledTimes(2);
		expect(await readImages(sources)).toHaveLength(2);
	});

	it("falls back to FileList and sniffs files without MIME metadata", async () => {
		const transfer = { files: [new File([png], "Screenshot")] } as unknown as DataTransfer;
		const images = await readImages(captureImageSources(transfer, true));
		expect(images[0]).toEqual({ data: png.toString("base64"), mimeType: "image/png", size: png.length });
	});

	it("retries transient screenshot reads", async () => {
		const screenshot = file();
		const read = vi.spyOn(screenshot, "arrayBuffer").mockRejectedValueOnce(new Error("NotReadableError"));
		expect(await readImages([{ file: screenshot }])).toHaveLength(1);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("uses a legacy entry when a handle is unavailable", async () => {
		const entry = { isFile: true, file: (resolve: (value: File) => void) => resolve(file()) } as FileSystemFileEntry;
		expect(await readImages([{ file: null, handle: Promise.resolve(null), entry }])).toHaveLength(1);
	});

	it("does not let a pending handle block an already-readable File", async () => {
		expect(await readImages([{ file: file(), handle: new Promise(() => {}) }])).toHaveLength(1);
	});

	it("does not invoke drop-only accessors on clipboard paste", async () => {
		const getHandle = vi.fn();
		const transfer = {
			items: [{ kind: "file", getAsFile: file, getAsFileSystemHandle: getHandle }],
		} as unknown as DataTransfer;
		expect(await readImages(captureImageSources(transfer, false))).toHaveLength(1);
		expect(getHandle).not.toHaveBeenCalled();
	});

	it("rejects oversized files before reading their bytes", async () => {
		const screenshot = file();
		Object.defineProperty(screenshot, "size", { value: 21 * 1024 * 1024 });
		const read = vi.spyOn(screenshot, "arrayBuffer");
		await expect(readImages([{ file: screenshot }])).rejects.toThrow("20 MB");
		expect(read).not.toHaveBeenCalled();
	});

	it("rejects non-image bytes despite an image MIME type", async () => {
		await expect(
			readImages([{ file: new File(["not an image"], "fake.png", { type: "image/png" }) }]),
		).rejects.toThrow("PNG");
	});
});
