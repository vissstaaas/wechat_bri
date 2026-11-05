export interface HistoryOptions {
    /** Restores the pre-epoch flat per-record snapshot listing. */
    records?: boolean;
}
/** One epoch in the default timeline view - which records changed at this
 * capture vs. which carried their previous snapshot over unchanged. */
export interface HistoryEpochRow {
    id: string;
    timestamp: string;
    changed: string[];
    carriedOver: string[];
}
/** One row in the `--records` flat per-record snapshot listing. */
export interface HistoryRecordRow {
    id: string;
    timestamp: string;
    label: string;
    recordChangeTag: string;
}
export type HistoryResult = {
    mode: "epochs";
    epochs: HistoryEpochRow[];
} | {
    mode: "records";
    records: HistoryRecordRow[];
};
/**
 * Lists a tracked note's recorded history, newest first. By default this is
 * the epoch timeline (one line per coordinated pull/push capture - see the
 * "Whole-note coordinated version epochs" investigation); `--records` (via
 * `options.records`) restores the previous per-record flat listing.
 */
export declare function runHistory(targetDir: string, fileArg: string, options?: HistoryOptions): Promise<HistoryResult>;
