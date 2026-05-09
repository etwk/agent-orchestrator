import { NextResponse } from "next/server";
import { getServices } from "@/lib/services";
import { AO_ISSUE_LABEL_DEFINITIONS } from "@/lib/issue-labels";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";

type SetupLabelResult =
  | { repo: string; label: string; status: "created" | "exists" }
  | { repo: string; label: string; status: "failed"; error: string };

function labelSetupErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAlreadyExistsError(err: unknown): boolean {
  return labelSetupErrorMessage(err).toLowerCase().includes("already exists");
}

/**
 * POST /api/setup-labels — Create agent labels on all configured repos.
 * Idempotent — skips labels that already exist.
 */
export async function POST() {
  try {
    const { config } = await getServices();
    const results: SetupLabelResult[] = [];

    for (const project of Object.values(config.projects)) {
      if (!project.repo) continue;

      for (const label of AO_ISSUE_LABEL_DEFINITIONS) {
        try {
          await execFileAsync(
            "gh",
            [
              "label",
              "create",
              label.name,
              "--repo",
              project.repo,
              "--color",
              label.color,
              "--description",
              label.description,
              "--force",
            ],
            { timeout: 10_000 },
          );
          results.push({ repo: project.repo, label: label.name, status: "created" });
        } catch (err) {
          if (isAlreadyExistsError(err)) {
            results.push({ repo: project.repo, label: label.name, status: "exists" });
          } else {
            results.push({
              repo: project.repo,
              label: label.name,
              status: "failed",
              error: labelSetupErrorMessage(err),
            });
          }
        }
      }
    }

    const hasFailures = results.some((result) => result.status === "failed");
    return NextResponse.json({ ok: !hasFailures, results }, { status: hasFailures ? 207 : 200 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to setup labels" },
      { status: 500 },
    );
  }
}
