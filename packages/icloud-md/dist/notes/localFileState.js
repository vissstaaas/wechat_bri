import { readFile } from "node:fs/promises";
import path from "node:path";
import { isEnoent } from "../fsUtil.js";
import { readBaseCopy } from "./baseCopy.js";
import { splitFrontmatter } from "./frontmatter.js";
export async function readLocalNote(targetDir, entry, recordName, titleMode = "in-body") {
    let content;
    try {
        content = await readFile(path.join(targetDir, entry.file), "utf-8");
    }
    catch (cause) {
        if (isEnoent(cause)) {
            return { status: "missing" };
        }
        throw cause;
    }
    // `titleMode` matters here for a reason that isn't obvious: under
    // filename-as-title a body can begin with a blank line, and splitting
    // without it folds that line into the envelope, so a freshly cloned note
    // never matches its base copy at all.
    const { frontmatter, body } = splitFrontmatter(content, { filenameAsTitle: titleMode === "filename" });
    const base = await readBaseCopy(targetDir, recordName);
    if (base === undefined) {
        // No base copy on disk for a tracked note shouldn't normally happen, but
        // if it does, we can't verify cleanliness - treat conservatively.
        return { status: "modified", frontmatter, body };
    }
    // Compare body-only: the base copy never carries frontmatter, so a local-
    // only frontmatter edit leaves the body equal to base and stays "clean" -
    // it must not read as a note change (which would trigger a spurious push).
    return { status: body === base ? "clean" : "modified", frontmatter, body };
}
export async function localFileState(targetDir, entry, recordName, titleMode = "in-body") {
    return (await readLocalNote(targetDir, entry, recordName, titleMode)).status;
}
//# sourceMappingURL=localFileState.js.map