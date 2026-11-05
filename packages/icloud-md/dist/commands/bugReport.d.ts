export interface BugReportSummary {
    outputPath: string;
    logEntryCount: number;
    /** Set only when at least one debug-log entry decoded to readable note/
     * table content - see buildContentPreview. This file is local-only and
     * deliberately not part of the report itself. */
    contentPreviewPath?: string;
}
export interface BugReportOptions {
    debugLogPath?: string;
    lastErrorPath?: string;
    /** Routes the disclosure warning (always stderr - the CLI wires this to
     * `console.error` in both human and `--json` mode); defaults to silent. */
    onDisclosure?: (message: string) => void;
}
/**
 * Warned before the bundle is written, per the "User-side bug report
 * scaffolding" brainstorm: content is included by default (a garbled table
 * or a dropped note is usually undiagnosable without seeing it), so
 * disclosure - not redaction - is what makes that inclusion an informed
 * choice rather than a silent one. Note titles, folder/sharer names, and
 * the account's dsid/appleId *are* redacted below (see redactCloneState /
 * redactDebugLogEntries) - what's left unredacted is the actual (compressed)
 * bytes of a note's own content, which can turn up in captured network
 * response bodies.
 */
export declare const DISCLOSURE_WARNING: string;
/** Parses a duration like `30m`/`6h`/`2d` into "that long ago from now". No
 * default window is offered on purpose - see the "User-side bug report
 * scaffolding" brainstorm: guessing a range risks silently missing the
 * relevant entries or oversweeping unrelated ones, so the CLI asks rather
 * than assumes. */
export declare function parseSinceDuration(value: string): Date | undefined;
/**
 * Bundles everything needed to troubleshoot a failure - tool/environment
 * version, the last recorded error, this folder's `state.json` (if
 * present), and the debug-log slice since `since` - into one Markdown file
 * the user can attach to a GitHub issue.
 */
export declare function runBugReport(targetDir: string, since: Date, options?: BugReportOptions): Promise<BugReportSummary>;
/**
 * Prints the stable alias `bug-report` will use for this tracked note,
 * without printing (or requiring the caller to share) its real title -
 * this is how a reporter tells the maintainer "the problem is with note-14"
 * instead of pasting the actual note title into a public GitHub issue.
 */
export interface BugReportIdentifyResult {
    file: string;
    alias: string;
}
export declare function runBugReportIdentify(targetDir: string, fileArg: string): Promise<BugReportIdentifyResult>;
