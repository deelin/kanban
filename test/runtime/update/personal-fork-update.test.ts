import { describe, expect, it, vi } from "vitest";
import { runAutoUpdateCheck, runOnDemandUpdate } from "../../../src/update/update";

describe("personal fork updates", () => {
	it("never checks or installs an upstream npm release automatically", async () => {
		const fetchLatestVersion = vi.fn();
		const spawnUpdate = vi.fn();
		await runAutoUpdateCheck({ currentVersion: "0.1.70-deelin.1", fetchLatestVersion, spawnUpdate });
		expect(fetchLatestVersion).not.toHaveBeenCalled();
		expect(spawnUpdate).not.toHaveBeenCalled();
	});

	it("directs manual updates to the fork without running npm", async () => {
		const fetchLatestVersion = vi.fn();
		const runUpdateCommand = vi.fn();
		const result = await runOnDemandUpdate({
			currentVersion: "0.1.70-deelin.1",
			fetchLatestVersion,
			runUpdateCommand,
		});
		expect(result.status).toBe("unsupported_installation");
		expect(result.message).toContain("https://github.com/deelin/kanban/releases");
		expect(fetchLatestVersion).not.toHaveBeenCalled();
		expect(runUpdateCommand).not.toHaveBeenCalled();
	});
});
