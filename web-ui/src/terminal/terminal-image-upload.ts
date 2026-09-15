import type { RuntimeCommandRunRequest, RuntimeCommandRunResponse } from "@/runtime/types";
import type { TerminalImage } from "@/terminal/terminal-image-transfer";

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
export type RunImageCommand = (input: RuntimeCommandRunRequest) => Promise<RuntimeCommandRunResponse>;

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

async function runScript(script: string, runCommand: RunImageCommand): Promise<string> {
	const result = await runCommand({ command: `node -e ${shellQuote(script)}` });
	if (result.exitCode !== 0) throw new Error(result.stderr || "Could not save the image.");
	return result.stdout.trim();
}

export async function removeTerminalImage(path: string, runCommand: RunImageCommand): Promise<void> {
	if (!/^\/tmp\/kanban-drop-[A-Za-z0-9]+\/image\.(png|jpg|gif|webp)$/.test(path)) {
		throw new Error("Invalid temporary image path.");
	}
	const directory = path.slice(0, path.lastIndexOf("/"));
	await runScript(`require("node:fs").rmSync(${JSON.stringify(directory)},{recursive:true,force:true});`, runCommand);
}

// Reuse the workspace-scoped command API so the bridge also works against a
// remote POSIX runtime. Bounded chunks stay below macOS's argument-size limit;
// only generated paths and validated base64 are inserted into shell commands.
export async function saveTerminalImage(image: TerminalImage, runCommand: RunImageCommand): Promise<string> {
	const extension = EXTENSIONS[image.mimeType];
	if (
		!extension ||
		!Number.isSafeInteger(image.size) ||
		image.size <= 0 ||
		image.size > 20 * 1024 * 1024 ||
		!/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)
	)
		throw new Error("Invalid image data.");
	const directory = await runScript(
		'const fs=require("node:fs");process.stdout.write(fs.mkdtempSync("/tmp/kanban-drop-"));',
		runCommand,
	);
	if (!/^\/tmp\/kanban-drop-[A-Za-z0-9]+$/.test(directory))
		throw new Error("Invalid image directory returned by Kanban.");
	const path = `${directory}/image.${extension}`;
	try {
		for (let offset = 0; offset < image.data.length; offset += 49152) {
			const chunk = image.data.slice(offset, offset + 49152);
			await runScript(
				`require("node:fs").writeFileSync(${JSON.stringify(path)},Buffer.from(${JSON.stringify(chunk)},"base64"),{flag:${JSON.stringify(offset ? "a" : "wx")},mode:0o600});`,
				runCommand,
			);
		}
		await runScript(
			`if(require("node:fs").statSync(${JSON.stringify(path)}).size!==${image.size})throw Error("Incomplete image upload");`,
			runCommand,
		);
		return path;
	} catch (error) {
		await removeTerminalImage(path, runCommand).catch(() => {});
		throw error;
	}
}
