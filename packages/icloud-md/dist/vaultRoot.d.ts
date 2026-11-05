/**
 * Walks up from `startDir` looking for a cloned vault's
 * `.icloud-md/state.json` - how git finds `.git` - so every command
 * works from anywhere inside the clone. Returns the vault root's absolute
 * path, or undefined when `startDir` isn't inside a clone (callers fall
 * back to "." so the existing not-a-cloned-directory error still names the
 * place the user actually ran the command).
 */
export declare function findVaultRoot(startDir: string): Promise<string | undefined>;
/**
 * Renders a vault-root-relative file path relative to the user's current
 * directory - `git status` from a subdirectory shows `../Other/file`, and
 * so do we. Presentation only: state and every internal lookup stay
 * vault-root-relative.
 */
export declare function displayPath(targetDir: string, file: string, cwd?: string): string;
