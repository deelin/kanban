import { captureImageSources, readImages } from "@/terminal/terminal-image-transfer";
import { type RunImageCommand, removeTerminalImage, saveTerminalImage } from "@/terminal/terminal-image-upload";

interface TerminalImageInputOptions {
	host: HTMLDivElement;
	// Returns a predicate bound to this particular PTY, or null if disconnected.
	captureSession: () => (() => boolean) | null;
	runCommand: RunImageCommand;
	paste: (path: string) => boolean;
	focus: () => void;
}

function hasFiles(transfer: DataTransfer | null): transfer is DataTransfer {
	return (
		!!transfer &&
		(Array.from(transfer.types || []).includes("Files") ||
			Array.from(transfer.items || []).some((item) => item.kind === "file"))
	);
}

export function installTerminalImageInput(options: TerminalImageInputOptions): () => void {
	const { host } = options;
	let busy = false;
	let disposed = false;
	let statusTimer: ReturnType<typeof setTimeout> | undefined;
	const status = document.createElement("div");
	status.setAttribute("role", "status");
	status.className =
		"absolute bottom-3 right-3 z-10 max-w-4/5 rounded-md bg-surface-1 px-3 py-2 text-[13px] text-text-primary pointer-events-none";
	status.hidden = true;
	host.classList.add("relative");
	host.appendChild(status);
	const show = (text: string, dismiss = false) => {
		if (disposed) return;
		clearTimeout(statusTimer);
		status.textContent = text;
		status.hidden = false;
		if (dismiss)
			statusTimer = setTimeout(() => {
				status.hidden = true;
			}, 6000);
	};
	const dragOver = (event: DragEvent) => {
		if (!hasFiles(event.dataTransfer)) return;
		event.preventDefault();
		event.stopPropagation();
		event.dataTransfer.dropEffect = "copy";
		if (!busy) show("Drop image to attach");
	};
	const dragLeave = (event: DragEvent) => {
		if (!busy && (!(event.relatedTarget instanceof Node) || !host.contains(event.relatedTarget)))
			status.hidden = true;
	};
	const receive = async (event: DragEvent | ClipboardEvent) => {
		const transfer = "dataTransfer" in event ? event.dataTransfer : event.clipboardData;
		if (!hasFiles(transfer)) return; // Preserve normal text paste and board drags.
		event.preventDefault();
		event.stopImmediatePropagation();
		if (busy) {
			show("Please wait for the current image to finish attaching.");
			return;
		}
		const sources = captureImageSources(transfer, event.type === "drop");
		if (!sources.length) {
			show("macOS did not provide a file. Save the screenshot, then drag it here.", true);
			return;
		}
		const isCurrentSession = options.captureSession();
		if (!isCurrentSession) {
			show("Reconnect this terminal before attaching an image.", true);
			return;
		}
		busy = true;
		show("Attaching image…");
		let unpastedPath: string | null = null;
		try {
			const images = await readImages(sources);
			for (const image of images) {
				if (disposed || !isCurrentSession())
					throw new Error("The terminal changed while attaching. Drop the image again.");
				unpastedPath = await saveTerminalImage(image, options.runCommand);
				if (disposed || !isCurrentSession())
					throw new Error("The terminal changed while attaching. Drop the image again.");
				if (!options.paste(unpastedPath))
					throw new Error("Terminal disconnected before the image could be attached.");
				unpastedPath = null;
			}
			show(images.length === 1 ? "Image attached" : `${images.length} images attached`, true);
			options.focus();
		} catch (error) {
			if (unpastedPath) await removeTerminalImage(unpastedPath, options.runCommand).catch(() => {});
			show(error instanceof Error ? error.message : "Could not attach the image.", true);
		} finally {
			busy = false;
		}
	};
	host.addEventListener("dragover", dragOver);
	host.addEventListener("dragleave", dragLeave);
	// Capture paste before xterm treats an image as an empty plain-text paste.
	host.addEventListener("drop", receive, true);
	host.addEventListener("paste", receive, true);
	return () => {
		disposed = true;
		clearTimeout(statusTimer);
		host.removeEventListener("dragover", dragOver);
		host.removeEventListener("dragleave", dragLeave);
		host.removeEventListener("drop", receive, true);
		host.removeEventListener("paste", receive, true);
		status.remove();
	};
}
