---
name: architectural-review
description: Build one markdown file that hands this codebase to an outside reviewer (Gemini, another AI, a person) for an architectural review - chosen source files in full, each under its own header, led by a written summary of what to review. Use this whenever the user asks for a codebase bundle, a "codebase context" file, an architectural review export, something "for Gemini to review", a markdown dump of source files to share or sync to Google Drive or Obsidian, or an update to emberhold_codebase_context.md, even if they never say "skill" or "bundle". Not for reviewing code yourself.
---

# Architectural review bundle

The reviewer gets this one file and nothing else: no repository, no history, no chance to ask what you meant. So the bundle has two jobs. It must carry the source exactly, and it must tell the reviewer where to look and why. A script does the first job; the second is yours.

## 1. Settle what goes in

Take these from the request; fall back to the defaults only for what the user left out.

- **Files.** The ones the user names. If they name none, read `CLAUDE.md` (or the README) and pick the files that hold the architecture, not every file. "Any modified test files" means the tests changed by the commits under review: find them with `git show --stat <commit>`.
- **Focus.** What the review is about: a new feature, a fork, a refactor, or the whole design. If the user did not say, the focus is the work since the last bundle.
- **Output name.** The one the user gives, else `<project>_codebase_context.md` in the project root, overwriting the last one.

Before overwriting an old bundle, read its first lines. Its header records the commit it was built from, and `git log <that commit>..HEAD` is the list of what changed since, which the summary should mention. If the bundle has a new name and so nothing to overwrite, list instead the commits that touched the bundled files since the work under review began (`git log <first commit of it>^..HEAD -- <files>`).

## 2. Understand the focus before writing about it

Read the commits (`git log`, `git show <commit>`) and the code they touch. A summary written from the commit message alone repeats what the reviewer could have guessed; one written from the code can say which line decides the outcome.

Measure where it is cheap, with whatever actually runs the code under review. For game rules or bot behaviour that is bot-only matches (see "Balance changes" in `CLAUDE.md`). For anything else, a short scratch script that drives the real module is fine: for client netcode, for example, feed the real predictor from the real sim through a made-up delay. Numbers let the reviewer judge the design by its effect, and they often show the most interesting question. Say how each number was measured, and label any figure you copied from a commit message as the author's and not re-measured.

## 3. Write the summary

Write it to a scratch file (not in the project). Use this shape, dropping a section only if it would be empty:

```markdown
One paragraph: what the project is, for someone who has never seen it.

**What to review:** the focus, in a sentence, with its commit.

## <Focus>: what it is
Plain words. What changes for a player or user.

## <Focus>: implementation
One numbered part per concern (state, rules, client, tests...). Quote the lines
that matter in code blocks, and say which file and function they are in.

### Measured
A small table, with how it was measured.

### Questions worth a reviewer's attention
Numbered. Real doubts about the design, each concrete enough to answer.

## Other changes since the previous bundle
`git log` one-liners, newest first, then two sentences that sum them up.

## Not included
Which files were left out, so the reviewer knows what they cannot see.
```

If a file matters to the focus but the user did not ask for it in full, show its part inside the summary: as a diff (`git show <commit> -- <path>`) if the commits under review changed it, or else by quoting the functions that matter under "Not included". Name that file under `quoted` in the manifest so its quotes are checked too.

Every code quote must be real: a reviewer who finds one invented line stops trusting the rest. The script checks this for you (step 4), but only line by line, so read each quote once against the source for lines that are repeated or out of order.

## 4. Build the bundle

Write a manifest next to the summary and run the script from the project root:

```json
{
  "out": "emberhold_codebase_context.md",
  "title": "Emberhold: codebase context for architectural review",
  "summary": "<path to the summary file>",
  "files": [
    { "path": "CLAUDE.md", "role": "Project guide: commands, architecture, known limits" },
    { "path": "public/sim.js", "role": "Every game rule" }
  ]
}
```

```bash
node .claude/skills/architectural-review/scripts/bundle.mjs <path to manifest.json>
```

The script adds the title, the date, branch and commit, a table of the files with line counts and roles, then each file whole under `## File: <path>`. It reads every file back out of the bundle and compares it with the source, and prints one line ending "every file identical to its source".

It then checks the summary's code quotes: every line inside a code block written in a bundled file's language must be a line of a bundled file, or of a file listed under `"quoted": ["server.js"]` in the manifest. Lines it cannot find are printed. Each one is a slip to fix, or a quote from a file to add to `quoted`; an elision written as `// ...` is ignored. Diffs, shell commands and JSON are not checked. If it exits with an error, fix the cause; do not hand-edit the bundle. It refuses files that exist to hold secrets (`.env`, key files). Look through anything else you bundle for tokens or passwords yourself, because this file is going to an outside service.

Give each file a `role` of a few words: the reviewer reads that table first.

## 5. Deliver

- Say where the file is, how large, which commit it is from, and what is not in it.
- If you have a tool for sending files to the user, send the file too, unless the request said not to. They may be away from the computer the file is on.
- Upload it to the user's Google Drive (next section), unless the request said not to upload.
- Leave it out of git. It is a copy of code the repository already has, and committing it would put a stale duplicate of every file in the history.

## Google Drive

Every finished bundle goes to the user's Google Drive, because that is where Gemini reads it. Tom asked for this as a standing step on 2026-11-15, so do not ask first. Skip it only when the request says not to upload, and say that you skipped it. A rebuilt bundle is uploaded again.

- Put it in the Drive folder "Emberhold review" (find it by title; create it in My Drive if it is gone).
- Upload as plain markdown (`text/markdown`), not converted to a Google Doc, so Gemini and Obsidian read it as written. With the Drive connector that is `create_file` with `disableConversionToGoogleType: true`, the file passed as a file reference (`sha256:<hash>:<absolute path>`), not pasted as text.
- Check that the size Drive reports equals the local file's size in bytes.
- The Drive connector can rename a file but cannot replace its contents. If a copy with the same name is already there: upload the new one, check its size, then move the old copy to the trash, and tell the user the link has changed.
- Do not share the file with anyone.
- Give the user the link. If no Drive tool is connected, say so plainly; the bundle is still done.
