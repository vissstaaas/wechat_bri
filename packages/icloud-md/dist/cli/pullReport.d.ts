import type { PullSummary } from "../commands/pull.js";
/**
 * Renders a pull's outcome the way `status` renders the push plan: a heading,
 * a blank line, the indented changelist (one coloured label per file, with
 * conflict/read-only remarks indented beneath the entries they belong to), a
 * blank line, and a tally. `formatPath` is the same presentation hook
 * `renderPlan` takes - the CLI passes a cwd-relativizer so paths read from
 * where the user is standing.
 */
export declare function renderPullReport(summary: PullSummary, formatPath?: (file: string) => string): string[];
