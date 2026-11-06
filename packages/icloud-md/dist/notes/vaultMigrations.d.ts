/**
 * Forward-only vault migrations.
 *
 * The project supports exactly one on-disk paradigm at a time: rather than
 * teaching every command to read several vault generations, a vault is
 * migrated up to `CURRENT_LAYOUT_VERSION` the moment icloud-md touches it,
 * and command code only ever sees the current shape. `openVault` is the
 * entry point that guarantees that, and every command that reads note data
 * goes through it instead of `readCloneState`.
 *
 * Deliberately *not* covered: layout version 1 (the original flat layout,
 * pre-folder-support). Writing a real flat->tree migration for 0.1-era
 * vaults isn't worth the code; those keep the existing "re-clone into a
 * fresh directory" refusal, which is why migrations start at version 2.
 *
 * Auth-only and diagnostic readers (`reauthenticate`, `verify-auth`,
 * `bug-report`) stay on the raw reader on purpose - they touch `account` or
 * report a vault's condition, and neither should rewrite a vault as a side
 * effect of asking a question about it.
 *
 * ## Writing a migration
 *
 * A migration must be **idempotent and re-runnable**. The `layoutVersion`
 * bump is the commit point and is written *after* the migration's file work
 * completes, so an interrupted run simply replays from the same version on
 * the next command. That only stays safe if replaying is harmless, so a
 * migration that rewrites files has to tolerate finding some of them already
 * rewritten.
 */
import { type CloneState, type RawStateFile } from "./cloneState.js";
/** The oldest `layoutVersion` the migration chain starts from. Anything
 * below this (including a state file with no version at all) is refused
 * rather than migrated - see the module comment. */
export declare const OLDEST_MIGRATABLE_LAYOUT_VERSION = 2;
export interface VaultMigrationContext {
    targetDir: string;
    /** The state file as it currently sits on disk - shaped for `from`, not
     * for the current version, which is why it's raw rather than `CloneState`. */
    state: RawStateFile;
}
export interface VaultMigration {
    /** The `layoutVersion` this migration reads. */
    from: number;
    /** The `layoutVersion` it produces - always `from + 1`, so the chain has
     * no gaps and each step is separately resumable. */
    to: number;
    /** One line for the progress log, e.g. "recording note ids in frontmatter". */
    describe: string;
    /** Performs the on-disk work and returns the updated state. The runner
     * stamps `to` and writes it; a migration must not write the state file
     * itself. */
    run(context: VaultMigrationContext): Promise<RawStateFile>;
}
/** The migration chain, ordered by `from`. */
export declare const VAULT_MIGRATIONS: readonly VaultMigration[];
/** A chain and the version it climbs to. Separated from the module-level
 * constants purely so the runner can be exercised against synthetic chains -
 * production only ever uses `DEFAULT_MIGRATION_PLAN`. */
export interface MigrationPlan {
    migrations: readonly VaultMigration[];
    targetVersion: number;
}
export declare const DEFAULT_MIGRATION_PLAN: MigrationPlan;
export interface OpenVaultOptions {
    /** Called once per migration actually run, for progress reporting. */
    onMigration?: (migration: VaultMigration) => void;
}
/**
 * `openVault` options that report each migration through a command's
 * ordinary status sink - the one-liner every command with a sink passes, so
 * a vault being brought forward says so instead of looking like a hang.
 *
 * Worth having because the v2 -> v3 migration touches every tracked file in
 * the vault: on a large one that is real time spent before the command the
 * user actually asked for has begun. Commands with no sink (`restore`,
 * `history`) pass nothing and stay silent, which is right - they are fast
 * enough that a migration is the only slow thing they could be doing, and
 * they have nowhere to say it.
 */
export declare function migrationReporter(onStatus?: (message: string) => void): OpenVaultOptions;
/**
 * Brings a vault up to `plan.targetVersion`, running each step in order and
 * committing after each. Returns false when `targetDir` isn't a clone at all.
 *
 * Throws `VaultFromNewerToolError` when the vault is *newer* than this build
 * understands: migrating forward means an older binary can encounter a shape
 * it has never seen, and it must say so plainly rather than guess (or, worse,
 * repeat the v1 advice to re-clone, which would be destructive here).
 */
export declare function runVaultMigrations(targetDir: string, plan?: MigrationPlan, onMigration?: (migration: VaultMigration) => void): Promise<boolean>;
/**
 * Reads a vault's state, migrating it forward first if it was written by an
 * older build. Returns undefined when `targetDir` isn't a clone at all,
 * matching `readCloneState` so callers keep their "not a cloned directory"
 * handling. This is what every command that reads note data should call.
 */
export declare function openVault(targetDir: string, options?: OpenVaultOptions): Promise<CloneState | undefined>;
