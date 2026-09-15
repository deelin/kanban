// @vitest-environment node
import { execFile } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { TerminalImage } from "@/terminal/terminal-image-transfer";
import {
	type RunImageCommand,
	removeTerminalImage,
	saveTerminalImage,
	shellQuote,
} from "@/terminal/terminal-image-upload";

const exec = promisify(execFile);
const run: RunImageCommand = async ({ command }) => {
	const { stdout, stderr } = await exec("/bin/sh", ["-c", command]);
	return { stdout, stderr, combinedOutput: stdout + stderr, exitCode: 0, durationMs: 0 };
};
const image: TerminalImage = { data: "aGVsbG8=", mimeType: "image/png", size: 5 };

describe("terminal image uploads", () => {
	it("quotes shell metacharacters literally", async () => {
		const value = "quotes' dollar$(false) `false`\nline";
		const { stdout } = await exec("/bin/sh", ["-c", `printf %s ${shellQuote(value)}`]);
		expect(stdout).toBe(value);
	});

	it("persists multiple chunks byte-for-byte in a private file", async () => {
		const bytes = Buffer.alloc(160000, 42);
		const path = await saveTerminalImage({ ...image, data: bytes.toString("base64"), size: bytes.length }, run);
		try {
			expect(await readFile(path)).toEqual(bytes);
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(dirname(path), { recursive: true });
		}
	});

	it("cleans up a partially uploaded image on a failed command", async () => {
		let calls = 0;
		let directory = "";
		await expect(
			saveTerminalImage(image, async (input) => {
				if (++calls === 2) throw new Error("simulated write failure");
				const result = await run(input);
				if (calls === 1) directory = result.stdout.trim();
				return result;
			}),
		).rejects.toThrow("simulated write failure");
		await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects invalid upload data before invoking any command", async () => {
		const command = vi.fn();
		await expect(saveTerminalImage({ ...image, data: "$(false)" }, command)).rejects.toThrow("Invalid");
		expect(command).not.toHaveBeenCalled();
	});

	it("refuses to clean up anything outside generated image directories", async () => {
		const command = vi.fn();
		await expect(removeTerminalImage("/tmp/something-else/image.png", command)).rejects.toThrow("Invalid");
		expect(command).not.toHaveBeenCalled();
	});
});
