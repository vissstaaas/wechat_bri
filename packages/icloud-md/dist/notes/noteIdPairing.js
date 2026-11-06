/**
 * Resolves which tracked note (if any) each untracked file *is*, using the
 * `apple-note-id` recorded in its frontmatter.
 *
 * Push sees a renamed or relocated note as two unrelated halves: a tracked
 * file that vanished, and an untracked file that appeared. Pairing them back
 * up used to be guesswork (see `push.ts`'s content-equality and
 * unique-basename fallbacks, which remain for id-less files). With ids in the
 * files, the pairing is exact - and stays exact when a note is renamed,
 * moved, and edited all in one go, which is precisely the case no heuristic
 * could ever recover.
 *
 * The resolution order is id, then path, then create:
 *
 *  - an id matching a tracked note *is* that note;
 *  - a file with no usable id but sitting at a tracked path is that note
 *    (load-bearing: a tracked file whose envelope got stripped by hand must
 *    not silently become a duplicate);
 *  - anything else is a new note, whose id is generated at push time.
 *
 * Nothing here is fatal. An absent id, a malformed one, and one pointing at
 * a note this vault has never heard of all degrade to "this is a new note"
 * rather than an error - a single bad frontmatter value must never fail a
 * whole push. The one exception is a genuinely unresolvable *duplicate*,
 * described under `ambiguous` below.
 */
/**
 * Sorts untracked files into moves, creates, and unresolvable duplicates.
 *
 * The incumbent rule is what makes duplicating a note in Obsidian do the
 * obviously right thing: if the original file is still sitting where it was,
 * it keeps the id and the copy becomes a note of its own.
 */
export function resolveNoteIds(input) {
    const tracked = new Set(input.trackedRecordNames);
    const resolution = { moves: [], creates: [], ambiguous: [], staleIds: [] };
    // Group claimants by id first: a decision about any one file depends on
    // how many others claim the same note.
    const claimsById = new Map();
    for (const candidate of input.untracked) {
        if (candidate.noteId === undefined) {
            continue;
        }
        const files = claimsById.get(candidate.noteId);
        if (files) {
            files.push(candidate.file);
        }
        else {
            claimsById.set(candidate.noteId, [candidate.file]);
        }
    }
    const resolvedAsMove = new Set();
    const refused = new Set();
    for (const [recordName, files] of claimsById) {
        if (!tracked.has(recordName)) {
            // A stale id: nothing to move, so every claimant is a new note.
            resolution.staleIds.push(...files);
            continue;
        }
        if (input.isTrackedFilePresent(recordName)) {
            // The original is still where it belongs and keeps the id; every
            // claimant here is a copy of it, and becomes a note of its own.
            continue;
        }
        if (files.length > 1) {
            resolution.ambiguous.push({ recordName, files: [...files] });
            for (const file of files) {
                refused.add(file);
            }
            continue;
        }
        const file = files[0];
        if (file !== undefined) {
            resolution.moves.push({ recordName, file });
            resolvedAsMove.add(file);
        }
    }
    for (const candidate of input.untracked) {
        if (!resolvedAsMove.has(candidate.file) && !refused.has(candidate.file)) {
            resolution.creates.push(candidate.file);
        }
    }
    return resolution;
}
//# sourceMappingURL=noteIdPairing.js.map