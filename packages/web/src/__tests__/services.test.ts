import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockLoadConfig,
  mockGetGlobalConfigPath,
  MockConfigNotFoundError,
  mockRegister,
  mockCreateSessionManager,
  mockRegistry,
  tmuxPlugin,
  claudePlugin,
  codexPlugin,
  opencodePlugin,
  worktreePlugin,
  scmPlugin,
  trackerGithubPlugin,
  trackerLinearPlugin,
} = vi.hoisted(() => {
  const mockLoadConfig = vi.fn();
  const mockGetGlobalConfigPath = vi.fn();
  class MockConfigNotFoundError extends Error {
    constructor(message?: string) {
      super(message ?? "Config not found");
      this.name = "ConfigNotFoundError";
    }
  }
  const mockRegister = vi.fn();
  const mockCreateSessionManager = vi.fn();
  const mockRegistry = {
    register: mockRegister,
    get: vi.fn(),
    list: vi.fn(),
    loadBuiltins: vi.fn(),
    loadFromConfig: vi.fn(),
  };

  return {
    mockLoadConfig,
    mockGetGlobalConfigPath,
    MockConfigNotFoundError,
    mockRegister,
    mockCreateSessionManager,
    mockRegistry,
    tmuxPlugin: { manifest: { name: "tmux" } },
    claudePlugin: { manifest: { name: "claude-code" } },
    codexPlugin: { manifest: { name: "codex" } },
    opencodePlugin: { manifest: { name: "opencode" } },
    worktreePlugin: { manifest: { name: "worktree" } },
    scmPlugin: { manifest: { name: "github" } },
    trackerGithubPlugin: { manifest: { name: "github" } },
    trackerLinearPlugin: { manifest: { name: "linear" } },
  };
});

vi.mock("@aoagents/ao-core", () => ({
  loadConfig: mockLoadConfig,
  getGlobalConfigPath: mockGetGlobalConfigPath,
  ConfigNotFoundError: MockConfigNotFoundError,
  createPluginRegistry: () => mockRegistry,
  createSessionManager: mockCreateSessionManager,
  createLifecycleManager: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    getStates: vi.fn(),
    check: vi.fn(),
  }),
  isOrchestratorSession: () => false,
  TERMINAL_STATUSES: new Set(["merged", "killed"]) as ReadonlySet<string>,
}));

vi.mock("@aoagents/ao-plugin-runtime-tmux", () => ({ default: tmuxPlugin }));
vi.mock("@aoagents/ao-plugin-agent-claude-code", () => ({ default: claudePlugin }));
vi.mock("@aoagents/ao-plugin-agent-codex", () => ({ default: codexPlugin }));
vi.mock("@aoagents/ao-plugin-agent-opencode", () => ({ default: opencodePlugin }));
vi.mock("@aoagents/ao-plugin-workspace-worktree", () => ({ default: worktreePlugin }));
vi.mock("@aoagents/ao-plugin-scm-github", () => ({ default: scmPlugin }));
vi.mock("@aoagents/ao-plugin-tracker-github", () => ({ default: trackerGithubPlugin }));
vi.mock("@aoagents/ao-plugin-tracker-linear", () => ({ default: trackerLinearPlugin }));

describe("services", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRegister.mockClear();
    mockCreateSessionManager.mockReset();
    mockLoadConfig.mockReset();
    mockGetGlobalConfigPath.mockReset();
    mockGetGlobalConfigPath.mockReturnValue("/tmp/global-config.yaml");
    mockLoadConfig.mockReturnValue({
      configPath: "/tmp/agent-orchestrator.yaml",
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
      projects: {},
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
    });
    mockCreateSessionManager.mockReturnValue({});
    delete (globalThis as typeof globalThis & { _aoServices?: unknown })._aoServices;
    delete (globalThis as typeof globalThis & { _aoServicesInit?: unknown })._aoServicesInit;
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { _aoServices?: unknown })._aoServices;
    delete (globalThis as typeof globalThis & { _aoServicesInit?: unknown })._aoServicesInit;
  });

  it("registers the OpenCode agent plugin with web services", async () => {
    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockRegister).toHaveBeenCalledWith(opencodePlugin);
  });

  it("registers the Codex agent plugin with web services", async () => {
    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockRegister).toHaveBeenCalledWith(codexPlugin);
  });

  it("caches initialized services across repeated calls", async () => {
    const { getServices } = await import("../lib/services");

    const first = await getServices();
    const second = await getServices();

    expect(first).toBe(second);
    expect(mockCreateSessionManager).toHaveBeenCalledTimes(1);
  });

  it("loads config from the canonical global config path", async () => {
    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockGetGlobalConfigPath).toHaveBeenCalledTimes(1);
    expect(mockLoadConfig).toHaveBeenCalledWith("/tmp/global-config.yaml");
  });

  it("falls back to discovered config when the canonical global config is missing", async () => {
    mockLoadConfig
      .mockImplementationOnce(() => {
        const error = new Error("ENOENT: no such file or directory");
        (error as Error & { code?: string }).code = "ENOENT";
        throw error;
      })
      .mockReturnValueOnce({
        configPath: "/tmp/local/agent-orchestrator.yaml",
        port: 3000,
        readyThresholdMs: 300_000,
        defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
        projects: {},
        notifiers: {},
        notificationRouting: { urgent: [], action: [], warning: [], info: [] },
        reactions: {},
      });

    const { getServices } = await import("../lib/services");

    await getServices();

    expect(mockLoadConfig).toHaveBeenNthCalledWith(1, "/tmp/global-config.yaml");
    expect(mockLoadConfig).toHaveBeenNthCalledWith(2);
  });
});

describe("pollBacklog", () => {
  const mockUpdateIssue = vi.fn();
  const mockListIssues = vi.fn();
  const mockIsCompleted = vi.fn();
  const mockGetIssue = vi.fn();
  const mockSpawn = vi.fn();
  const mockSessionList = vi.fn();

  beforeEach(async () => {
    vi.resetModules();
    mockRegister.mockClear();
    mockRegistry.get.mockReset();
    mockCreateSessionManager.mockReset();
    mockLoadConfig.mockReset();
    mockUpdateIssue.mockReset();
    mockListIssues.mockReset();
    mockIsCompleted.mockReset();
    mockGetIssue.mockReset();
    mockSpawn.mockReset();
    mockSessionList.mockReset();

    delete (
      globalThis as typeof globalThis & {
        _aoBacklogPollInFlight?: unknown;
      }
    )._aoBacklogPollInFlight;
    mockLoadConfig.mockReturnValue({
      configPath: "/tmp/agent-orchestrator.yaml",
      port: 3000,
      readyThresholdMs: 300_000,
      defaults: { runtime: "tmux", agent: "claude-code", workspace: "worktree", notifiers: [] },
      projects: {
        "test-project": {
          path: "/tmp/test-project",
          tracker: { plugin: "github" },
          backlog: { label: "agent:backlog", maxConcurrent: 5 },
        },
      },
      notifiers: {},
      notificationRouting: { urgent: [], action: [], warning: [], info: [] },
      reactions: {},
    });

    mockCreateSessionManager.mockReturnValue({
      spawn: mockSpawn,
      list: mockSessionList.mockResolvedValue([]),
    });

    delete (globalThis as typeof globalThis & { _aoServices?: unknown })._aoServices;
    delete (globalThis as typeof globalThis & { _aoServicesInit?: unknown })._aoServicesInit;
  });

  afterEach(() => {
    delete (globalThis as typeof globalThis & { _aoServices?: unknown })._aoServices;
    delete (globalThis as typeof globalThis & { _aoServicesInit?: unknown })._aoServicesInit;
    delete (
      globalThis as typeof globalThis & {
        _aoBacklogPollInFlight?: unknown;
      }
    )._aoBacklogPollInFlight;
  });

  it("removes agent:backlog label when claiming an issue", async () => {
    const backlogIssue = {
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: ["agent:backlog"],
    };
    mockListIssues.mockImplementation(async (filters: { labels?: string[] }) =>
      filters.labels?.includes("agent:backlog") ? [backlogIssue] : [],
    );

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      if (slot === "agent") {
        return { name: "claude-code" };
      }
      if (slot === "runtime") {
        return { name: "tmux" };
      }
      if (slot === "workspace") {
        return { name: "worktree" };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "123",
      {
        labels: ["agent:in-progress"],
        removeLabels: ["agent:backlog"],
        comment: "Claimed by agent orchestrator — session spawned.",
      },
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });

  it("does not mark already-completed merged-session issues for verification", async () => {
    mockSessionList.mockResolvedValue([
      {
        id: "test-1",
        projectId: "test-project",
        issueId: "28",
        status: "merged",
        metadata: {},
        lifecycle: { pr: { state: "merged" } },
      },
    ]);
    mockIsCompleted.mockResolvedValue(true);
    mockListIssues.mockResolvedValue([]);

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();

    expect(mockIsCompleted).toHaveBeenCalledWith(
      "28",
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
    expect(mockUpdateIssue).not.toHaveBeenCalledWith(
      "28",
      expect.objectContaining({ labels: ["merged-unverified"] }),
      expect.anything(),
    );
  });

  it("marks open merged-session issues for verification", async () => {
    mockSessionList.mockResolvedValue([
      {
        id: "test-1",
        projectId: "test-project",
        issueId: "123",
        status: "merged",
        metadata: {},
        lifecycle: { pr: { state: "merged" } },
      },
    ]);
    mockIsCompleted.mockResolvedValue(false);
    mockGetIssue.mockResolvedValue({
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: [],
    });
    mockListIssues.mockResolvedValue([]);

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "123",
      {
        labels: ["merged-unverified"],
        removeLabels: ["agent:backlog", "agent:in-progress"],
        comment: "PR merged. Issue awaiting human verification on staging.",
      },
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });

  it("retries marking merged-session issues after tracker update failures", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockSessionList.mockResolvedValue([
      {
        id: "test-1",
        projectId: "test-project",
        issueId: "123",
        status: "merged",
        metadata: {},
        lifecycle: { pr: { state: "merged" } },
      },
    ]);
    mockIsCompleted.mockResolvedValue(false);
    mockGetIssue.mockResolvedValue({
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: [],
    });
    mockListIssues.mockResolvedValue([]);
    mockUpdateIssue.mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    try {
      await pollBacklog();
      await pollBacklog();
    } finally {
      consoleError.mockRestore();
    }

    expect(mockUpdateIssue).toHaveBeenCalledTimes(2);
  });

  it("allows a new merged session for the same reopened issue to be marked for verification", async () => {
    const oldSession = {
      id: "test-old",
      projectId: "test-project",
      issueId: "123",
      status: "merged",
      metadata: {},
      lifecycle: { pr: { state: "merged" } },
    };
    const newSession = {
      id: "test-new",
      projectId: "test-project",
      issueId: "123",
      status: "merged",
      metadata: {},
      lifecycle: { pr: { state: "merged" } },
    };
    mockSessionList
      .mockResolvedValueOnce([oldSession])
      .mockResolvedValueOnce([oldSession, newSession]);
    mockIsCompleted.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mockGetIssue.mockResolvedValue({
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: [],
    });
    mockListIssues.mockResolvedValue([]);

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();
    await pollBacklog();

    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ labels: ["merged-unverified"] }),
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });

  it("does not re-comment merged-session issues already awaiting verification", async () => {
    mockSessionList.mockResolvedValue([
      {
        id: "test-1",
        projectId: "test-project",
        issueId: "123",
        status: "merged",
        metadata: {},
        lifecycle: { pr: { state: "merged" } },
      },
    ]);
    mockIsCompleted.mockResolvedValue(false);
    mockGetIssue.mockResolvedValue({
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: ["merged-unverified"],
    });
    mockListIssues.mockResolvedValue([]);

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    await pollBacklog();

    expect(mockUpdateIssue).not.toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ labels: ["merged-unverified"] }),
      expect.anything(),
    );
  });

  it("returns reopened completed issues to backlog instead of marking them for verification", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockSessionList.mockResolvedValue([
      {
        id: "test-1",
        projectId: "test-project",
        issueId: "123",
        status: "merged",
        metadata: {},
        lifecycle: { pr: { state: "merged" } },
      },
    ]);
    mockIsCompleted.mockResolvedValue(false);
    mockGetIssue.mockResolvedValue({
      id: "123",
      title: "Test Issue",
      description: "Test description",
      url: "https://github.com/test/test/issues/123",
      state: "open",
      labels: ["agent:done"],
    });
    mockListIssues.mockImplementation(async (filters: { labels?: string[] }) =>
      filters.labels?.includes("agent:done")
        ? [
            {
              id: "123",
              title: "Test Issue",
              description: "Test description",
              url: "https://github.com/test/test/issues/123",
              state: "open",
              labels: ["agent:done"],
            },
          ]
        : [],
    );

    mockRegistry.get.mockImplementation((slot: string) => {
      if (slot === "tracker") {
        return {
          name: "github",
          listIssues: mockListIssues,
          isCompleted: mockIsCompleted,
          getIssue: mockGetIssue,
          updateIssue: mockUpdateIssue,
        };
      }
      return null;
    });

    const { pollBacklog } = await import("../lib/services");
    try {
      await pollBacklog();
    } finally {
      consoleLog.mockRestore();
    }

    expect(mockUpdateIssue).not.toHaveBeenCalledWith(
      "123",
      expect.objectContaining({ labels: ["merged-unverified"] }),
      expect.anything(),
    );
    expect(mockUpdateIssue).toHaveBeenCalledWith(
      "123",
      {
        labels: ["agent:backlog"],
        removeLabels: ["agent:done"],
        comment: "Issue reopened — returning to agent backlog.",
      },
      expect.objectContaining({ tracker: { plugin: "github" } }),
    );
  });

  it("skips overlapping backlog poll runs", async () => {
    let resolveList: (sessions: unknown[]) => void = () => undefined;
    const listStarted = new Promise<void>((resolve) => {
      mockSessionList.mockImplementationOnce(
        () =>
          new Promise((resolveSessionList) => {
            resolveList = resolveSessionList as (sessions: unknown[]) => void;
            resolve();
          }),
      );
    });

    mockRegistry.get.mockReturnValue(null);

    const { pollBacklog } = await import("../lib/services");
    const firstPoll = pollBacklog();
    await listStarted;

    await pollBacklog();

    expect(mockSessionList).toHaveBeenCalledTimes(1);
    resolveList([]);
    await firstPoll;
  });
});
