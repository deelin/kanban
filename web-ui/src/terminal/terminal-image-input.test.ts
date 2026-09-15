import { afterEach, describe, expect, it, vi } from "vitest";
import { installTerminalImageInput } from "@/terminal/terminal-image-input";
import { removeTerminalImage, saveTerminalImage } from "@/terminal/terminal-image-upload";

vi.mock("@/terminal/terminal-image-upload", () => ({
	saveTerminalImage: vi.fn().mockResolvedValue("/tmp/kanban-drop-Test/image.png"),
	removeTerminalImage: vi.fn().mockResolvedValue(undefined),
}));

const disposers: Array<() => void> = [];
afterEach(() => {
	for (const dispose of disposers.splice(0)) dispose();
	document.body.replaceChildren();
	vi.clearAllMocks();
});

function setup() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const paste = vi.fn(() => true);
	const current = vi.fn(() => true);
	const captureSession = vi.fn(() => current);
	disposers.push(installTerminalImageInput({ host, paste, captureSession, focus: vi.fn(), runCommand: vi.fn() }));
	return { host, paste, current, captureSession };
}

function drop(host: HTMLElement, type = "drop", hasImage = true) {
	const file = new File(["fixture"], "Screenshot.png", { type: "image/png" });
	Object.defineProperty(file, "arrayBuffer", { value: async () => Uint8Array.from([137, 80, 78, 71]).buffer });
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, type === "drop" ? "dataTransfer" : "clipboardData", {
		value: hasImage
			? { types: ["Files"], items: [{ kind: "file", getAsFile: () => file }], files: [file] }
			: { types: ["text/plain"], items: [] },
	});
	host.dispatchEvent(event);
	return event;
}

describe("terminal image input", () => {
	it.each(["drop", "paste"])("attaches an image on %s without submitting a prompt", async (type) => {
		const { host, paste } = setup();
		expect(drop(host, type).defaultPrevented).toBe(true);
		await vi.waitFor(() => expect(paste).toHaveBeenCalledExactlyOnceWith("/tmp/kanban-drop-Test/image.png"));
		expect(host.textContent).toContain("Image attached");
	});

	it("preserves normal text paste", () => {
		const { host, paste } = setup();
		expect(drop(host, "paste", false).defaultPrevented).toBe(false);
		expect(paste).not.toHaveBeenCalled();
	});

	it("cleans up and blocks paste if the PTY changes during upload", async () => {
		let finish: (path: string) => void = () => {};
		vi.mocked(saveTerminalImage).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const { host, paste, current } = setup();
		drop(host);
		await vi.waitFor(() => expect(saveTerminalImage).toHaveBeenCalled());
		current.mockReturnValue(false);
		finish("/tmp/kanban-drop-Test/image.png");
		await vi.waitFor(() => expect(removeTerminalImage).toHaveBeenCalled());
		expect(paste).not.toHaveBeenCalled();
		expect(host.textContent).toContain("terminal changed");
	});

	it("removes its handlers when the terminal is disposed", () => {
		const { host, paste } = setup();
		disposers.pop()?.();
		expect(drop(host).defaultPrevented).toBe(false);
		expect(paste).not.toHaveBeenCalled();
		expect(host.querySelector('[role="status"]')).toBeNull();
	});
});
