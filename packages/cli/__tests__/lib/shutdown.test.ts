import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordActivityEvent } from "@aoagents/ao-core";

const {
  mockLoadAllProjectsConfigWithFallback,
  mockListStoredSessions,
  mockKillSession,
  mockGetSessionManager,
  mockStopAllLifecycleWorkers,
  mockStopProjectSupervisor,
  mockUnregister,
  mockWriteLastStop,
  mockStopBunTmpJanitor,
  mockIsTerminalSession,
  mockMarkDaemonShutdownHandlerInstalled,
  mockSweepDaemonChildren,
} = vi.hoisted(() => ({
  mockLoadAllProjectsConfigWithFallback: vi.fn(),
  mockListStoredSessions: vi.fn(),
  mockKillSession: vi.fn(),
  mockGetSessionManager: vi.fn(),
  mockStopAllLifecycleWorkers: vi.fn(),
  mockStopProjectSupervisor: vi.fn(),
  mockUnregister: vi.fn(),
  mockWriteLastStop: vi.fn(),
  mockStopBunTmpJanitor: vi.fn(),
  mockIsTerminalSession: vi.fn(),
  mockMarkDaemonShutdownHandlerInstalled: vi.fn(),
  mockSweepDaemonChildren: vi.fn(),
}));

vi.mock("@aoagents/ao-core", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  const actual = await importOriginal<typeof import("@aoagents/ao-core")>();
  return {
    ...actual,
    isTerminalSession: (...args: unknown[]) => mockIsTerminalSession(...args),
    markDaemonShutdownHandlerInstalled: (...args: unknown[]) =>
      mockMarkDaemonShutdownHandlerInstalled(...args),
    recordActivityEvent: vi.fn(),
    sweepDaemonChildren: (...args: unknown[]) => mockSweepDaemonChildren(...args),
  };
});

vi.mock("../../src/lib/all-projects-config.js", () => ({
  loadAllProjectsConfigWithFallback: (...args: unknown[]) =>
    mockLoadAllProjectsConfigWithFallback(...args),
}));

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: (...args: unknown[]) => mockGetSessionManager(...args),
}));

vi.mock("../../src/lib/lifecycle-service.js", () => ({
  stopAllLifecycleWorkers: (...args: unknown[]) => mockStopAllLifecycleWorkers(...args),
}));

vi.mock("../../src/lib/project-supervisor.js", () => ({
  stopProjectSupervisor: (...args: unknown[]) => mockStopProjectSupervisor(...args),
}));

vi.mock("../../src/lib/running-state.js", () => ({
  unregister: (...args: unknown[]) => mockUnregister(...args),
  writeLastStop: (...args: unknown[]) => mockWriteLastStop(...args),
}));

vi.mock("../../src/lib/bun-tmp-janitor.js", () => ({
  stopBunTmpJanitor: (...args: unknown[]) => mockStopBunTmpJanitor(...args),
}));

const recordedEvents = (): Array<Record<string, unknown>> =>
  vi.mocked(recordActivityEvent).mock.calls.map((c) => c[0] as Record<string, unknown>);

const flushAsync = async (): Promise<void> => {
  // The shutdown handler launches an async IIFE; allow it to settle.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
  }
};

describe("shutdown handler", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let originalListenersSigint: NodeJS.SignalsListener[];
  let originalListenersSigterm: NodeJS.SignalsListener[];

  beforeEach(() => {
    vi.resetModules();
    vi.mocked(recordActivityEvent).mockClear();
    mockLoadAllProjectsConfigWithFallback.mockReset();
    mockListStoredSessions.mockReset();
    mockKillSession.mockReset();
    mockGetSessionManager.mockReset();
    mockStopAllLifecycleWorkers.mockReset();
    mockStopProjectSupervisor.mockReset();
    mockUnregister.mockReset();
    mockWriteLastStop.mockReset();
    mockStopBunTmpJanitor.mockReset();
    mockIsTerminalSession.mockReset();
    mockMarkDaemonShutdownHandlerInstalled.mockReset();
    mockSweepDaemonChildren.mockReset();

    mockLoadAllProjectsConfigWithFallback.mockReturnValue({ config: { projects: {} } });
    mockGetSessionManager.mockResolvedValue({
      listStored: mockListStoredSessions,
      kill: mockKillSession,
    });
    mockListStoredSessions.mockResolvedValue([]);
    mockKillSession.mockResolvedValue({ cleaned: true });
    mockUnregister.mockResolvedValue(undefined);
    mockWriteLastStop.mockResolvedValue(undefined);
    mockStopBunTmpJanitor.mockResolvedValue(undefined);
    mockIsTerminalSession.mockReturnValue(false);
    mockSweepDaemonChildren.mockResolvedValue(undefined);

    originalListenersSigint = process.listeners("SIGINT") as NodeJS.SignalsListener[];
    originalListenersSigterm = process.listeners("SIGTERM") as NodeJS.SignalsListener[];

    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();

    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    for (const listener of originalListenersSigint) process.on("SIGINT", listener);
    for (const listener of originalListenersSigterm) process.on("SIGTERM", listener);
  });

  it("unregisters and exits even when cleanup config loading fails", async () => {
    mockLoadAllProjectsConfigWithFallback.mockImplementation(() => {
      throw new Error("invalid global config");
    });

    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    installShutdownHandlers({
      configPath: "/local/agent-orchestrator.yaml",
      projectId: "project-1",
    });

    process.emit("SIGTERM", "SIGTERM");

    await vi.waitFor(() => expect(mockUnregister).toHaveBeenCalledTimes(1));
    expect(mockGetSessionManager).not.toHaveBeenCalled();
    expect(mockStopBunTmpJanitor).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  });

  it("uses the fallback all-project config for graceful session cleanup", async () => {
    const config = { projects: { "project-1": {}, "project-2": {} } };
    mockLoadAllProjectsConfigWithFallback.mockReturnValue({
      config,
      warning: "using fallback",
    });
    mockListStoredSessions.mockResolvedValue([
      { id: "p1-1", projectId: "project-1", status: "working", activity: "active" },
      { id: "p2-1", projectId: "project-2", status: "working", activity: "active" },
    ]);

    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    installShutdownHandlers({
      configPath: "/local/agent-orchestrator.yaml",
      projectId: "project-1",
    });

    process.emit("SIGINT", "SIGINT");

    await vi.waitFor(() => expect(mockWriteLastStop).toHaveBeenCalledTimes(1));
    expect(mockLoadAllProjectsConfigWithFallback).toHaveBeenCalledWith(
      "/local/agent-orchestrator.yaml",
    );
    expect(mockListStoredSessions).toHaveBeenCalledTimes(1);
    expect(mockKillSession).toHaveBeenCalledWith("p1-1");
    expect(mockKillSession).toHaveBeenCalledWith("p2-1");
    expect(mockWriteLastStop).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        sessionIds: ["p1-1"],
        otherProjects: [{ projectId: "project-2", sessionIds: ["p2-1"] }],
      }),
    );
    expect(mockUnregister).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(130));
  });

  it("emits cli.shutdown_signal when SIGINT is received", async () => {
    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    installShutdownHandlers({ configPath: "/tmp/cfg.yaml", projectId: "p1" });

    process.emit("SIGINT", "SIGINT");
    await flushAsync();

    expect(recordedEvents()).toContainEqual(
      expect.objectContaining({
        kind: "cli.shutdown_signal",
        source: "cli",
        projectId: "p1",
        data: expect.objectContaining({ signal: "SIGINT", exitCode: 130 }),
      }),
    );
  });

  it("emits cli.shutdown_completed after clean shutdown", async () => {
    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    installShutdownHandlers({ configPath: "/tmp/cfg.yaml", projectId: "p1" });

    process.emit("SIGTERM", "SIGTERM");
    await flushAsync();

    expect(recordedEvents()).toContainEqual(
      expect.objectContaining({
        kind: "cli.shutdown_completed",
        source: "cli",
        projectId: "p1",
      }),
    );
  });

  it("emits cli.shutdown_failed when shutdown body throws before completion", async () => {
    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    mockGetSessionManager.mockRejectedValue(new Error("getSessionManager boom"));

    installShutdownHandlers({ configPath: "/tmp/cfg.yaml", projectId: "p1" });

    process.emit("SIGTERM", "SIGTERM");
    await flushAsync();

    const events = recordedEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "cli.shutdown_failed",
        source: "cli",
        level: "error",
        data: expect.objectContaining({ errorMessage: "getSessionManager boom" }),
      }),
    );
    expect(events.filter((event) => event.kind === "cli.shutdown_completed")).toHaveLength(0);
  });

  it("still unregisters running state when writing last-stop state fails", async () => {
    const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
    mockListStoredSessions.mockResolvedValue([
      {
        id: "s1",
        projectId: "p1",
        status: "working",
      },
    ]);
    mockWriteLastStop.mockRejectedValue(new Error("disk full"));

    installShutdownHandlers({ configPath: "/tmp/cfg.yaml", projectId: "p1" });

    process.emit("SIGTERM", "SIGTERM");
    await flushAsync();

    expect(mockWriteLastStop).toHaveBeenCalled();
    expect(mockUnregister).toHaveBeenCalled();

    const events = recordedEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "cli.last_stop_write_failed",
        source: "cli",
        level: "error",
        data: expect.objectContaining({
          targetSessionCount: 1,
          otherProjectCount: 0,
          totalKilled: 1,
          errorMessage: "disk full",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        kind: "cli.shutdown_completed",
        source: "cli",
        projectId: "p1",
      }),
    );
    expect(events.filter((event) => event.kind === "cli.shutdown_failed")).toHaveLength(0);
  });

  it("emits cli.shutdown_force_exit when the 10s timer fires", async () => {
    vi.useFakeTimers();
    try {
      const { installShutdownHandlers } = await import("../../src/lib/shutdown.js");
      mockGetSessionManager.mockReturnValue(new Promise(() => {}));

      installShutdownHandlers({ configPath: "/tmp/cfg.yaml", projectId: "p1" });

      process.emit("SIGINT", "SIGINT");
      await vi.advanceTimersByTimeAsync(10_000);

      expect(recordedEvents()).toContainEqual(
        expect.objectContaining({
          kind: "cli.shutdown_force_exit",
          source: "cli",
          level: "warn",
          data: expect.objectContaining({ timeoutMs: 10_000, exitCode: 130 }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
