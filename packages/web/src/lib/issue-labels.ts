/** Shared issue labels used by the web backlog and verification flows. */
export const AO_ISSUE_LABELS = {
  BACKLOG: "agent:backlog",
  IN_PROGRESS: "agent:in-progress",
  BLOCKED: "agent:blocked",
  DONE: "agent:done",
  MERGED_UNVERIFIED: "merged-unverified",
  VERIFICATION_FAILED: "verification-failed",
  VERIFIED: "verified",
} as const;

export const AO_ISSUE_LABEL_DEFINITIONS = [
  { name: AO_ISSUE_LABELS.BACKLOG, color: "6B7280", description: "Available for agent to claim" },
  { name: AO_ISSUE_LABELS.IN_PROGRESS, color: "7C3AED", description: "Agent is working on this" },
  { name: AO_ISSUE_LABELS.BLOCKED, color: "DC2626", description: "Agent is blocked" },
  { name: AO_ISSUE_LABELS.DONE, color: "16A34A", description: "Agent completed this" },
  {
    name: AO_ISSUE_LABELS.MERGED_UNVERIFIED,
    color: "F59E0B",
    description: "Merged PR awaiting verification",
  },
  {
    name: AO_ISSUE_LABELS.VERIFICATION_FAILED,
    color: "DC2626",
    description: "Verification failed",
  },
  { name: AO_ISSUE_LABELS.VERIFIED, color: "16A34A", description: "Fix verified" },
] as const;
