# Storage and coordination

All personal files live under Git-ignored `workspace/`. `jobs.json` is authoritative. The dashboard reads it live and writes individual records with version checks. Browser and desktop show the same data. Use one source for every tracked requisition. Do not maintain a second status checklist.

- `jobs.json` is an array. Each record has unique `id`, `company`, `title`, `url`, `status`, `notes`, `date` (date tracked) and optional `updatedAt` (version). Status labels are defined in `scripts/store.py`.
- Use optional `location`, `term`, `cycle`, `pay`, `source`, `ats`, `resumePath`, `tailorMode`, `action`, `actionLink`, `deadline`, `waasPitch`, `urgent`, and `eligibility` fields. Keep `stageDates` as a map of actual dates with keys such as `applied`, `screen`, `assessment`, `interview`, `offer` and `rejected`. A resume path is relative to `workspace/`. `aliases` is an optional array of alternate posting URLs. Preserve unknown fields.
- `profile.json` contains the dashboard preferences, including `graduation` as YYYY-MM or YYYY-MM-DD. `profile.md` and the banks hold evidence. Do not transcribe private identifiers into activity data.
- `contacts.json` stores one record per relationship. Use `linkedin` or `email` as channel. Keep `conversation`, `meeting`, `referral` and `mechanism` separate. Write a minimal summary, next review date and draft. Keep raw message history in the original inbox.
- `activity.json` is the shared activity log. Log timestamp, scope and short summary of each material change. Attribute the actor in the summary if needed. Avoid secrets and message bodies.
- `sources.json` lists configured import sources. `discovery.json` is a review queue, separate from applied or prepared jobs.

Prefer the dashboard or `scripts/store.py` helpers for writes. Use `transaction()` around read-modify-write, `write()` for atomic replacement and `log()` for material changes. Use `edit_job()` for one record with its current `updatedAt` as `expected`. Read current state again after a conflict. If a crashed write leaves `workspace/.write-lock`, verify all writers have exited before removing the empty directory. Use `scripts/backup.py` to create an explicit local backup. Store it privately.
