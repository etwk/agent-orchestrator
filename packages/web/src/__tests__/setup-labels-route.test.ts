import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFile, mockGetServices } = vi.hoisted(() => ({
  mockExecFile: vi.fn(
    (
      _cmd: string,
      _args: string[],
      _opts: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => callback(null, "", ""),
  ),
  mockGetServices: vi.fn(async () => ({
    config: {
      projects: {
        app: { repo: "acme/app" },
      },
    },
  })),
}));

vi.mock("node:child_process", () => ({
  default: { execFile: mockExecFile },
  execFile: mockExecFile,
}));

vi.mock("@/lib/services", () => ({
  getServices: mockGetServices,
}));

import { POST } from "@/app/api/setup-labels/route";
import { AO_ISSUE_LABELS } from "@/lib/issue-labels";

describe("POST /api/setup-labels", () => {
  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(null, "", ""),
    );
  });

  it("creates every label used by backlog and verification flows", async () => {
    const response = await POST();
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    const createdLabels = mockExecFile.mock.calls.map(([, args]) => args[2]);
    expect(createdLabels).toEqual(
      expect.arrayContaining([
        AO_ISSUE_LABELS.BACKLOG,
        AO_ISSUE_LABELS.IN_PROGRESS,
        AO_ISSUE_LABELS.BLOCKED,
        AO_ISSUE_LABELS.DONE,
        AO_ISSUE_LABELS.MERGED_UNVERIFIED,
        AO_ISSUE_LABELS.VERIFICATION_FAILED,
        AO_ISSUE_LABELS.VERIFIED,
      ]),
    );
  });

  it("reports label setup failures instead of treating them as existing labels", async () => {
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(new Error("gh auth missing"), "", ""),
    );

    const response = await POST();
    const body = (await response.json()) as {
      ok: boolean;
      results: Array<{ label: string; status: string; error?: string }>;
    };

    expect(response.status).toBe(207);
    expect(body.ok).toBe(false);
    expect(body.results).toContainEqual(
      expect.objectContaining({
        label: AO_ISSUE_LABELS.MERGED_UNVERIFIED,
        status: "failed",
        error: "gh auth missing",
      }),
    );
  });
});
