# Discovery, screening, and priority

Run `python3 scripts/sources.py`. Add `--match 'intern|co-op'` for a title filter. Read `workspace/discovery.json` for source errors and candidates. A timeout, empty page paired with a nonzero count, authentication wall or an incomplete scan is not evidence that a job closed. Check the official posting.

## Configure sources

Copy individual examples from `templates/sources.example.json` into `workspace/sources.json`. Public ATS options use company labels and board slugs. Greenhouse, Lever and Ashby use their public job listing APIs. Workday takes `host`, `tenant`, `site` and an optional search `query`. SmartRecruiters takes a board slug. Eightfold takes `base_url`, `domain` and optional `variant: "pcsx"`. Jibe takes `base_url`. Oracle takes `base_url`, `site` and `careers_url`. Extended adapters are for internship and co-op listings. Employers may change or disable their feeds.

- SimplifyJobs uses a public listings JSON feed. Choose a feed that fits the user's desired cycle. Follow the link to check the employer's actual posting.
- School and community boards can be imported from CSV, JSON or XLSX. Place files in `workspace/imports/`. Accepted column names are `company`, `title`, `location`, `url` and optional `cycle` and `description`. XLSX requires `openpyxl` and supports `sheet`, `header_row` and a `columns` map of input headers (lowercase) to field names. For a linked-title column, map it to `url` and supply another title column or confirm the title from the posting.
- Work at a Startup uses the user's own account or available connector. You can use the [optional upstream connector](https://github.com/Thespaceblade/waas-mcp) and export normalized results to JSON with `label: "yc"`. Save a tailored founder pitch under the specific job. Keep platform limits and exact outcome evidence in view.
- For a private school board, community newsletter or social story, read it through a user-authorized connection and record actual posting links in an import. Skip an inaccessible source and identify it by name. Keep source-side seen state or item IDs separate from whether a job was screened or applied to.

## Check eligibility and duplicates

Check degree level, graduation, start/end dates, work authorization or sponsorship, location, active status and explicit job requirements. Run `python3 scripts/eligibility.py /path/to/posting.md` when a graduation window is stated. The helper parses common month and season patterns and flags possible mismatches for review. Compare the exact requirement against the confirmed profile before excluding anyone. A window includes its stated end month unless the employer says otherwise. Treat term-time work as eligible when the candidate says they can take it.

Compare stable ATS identities and posting aliases before comparing company, title, geography and cycle. `python3 scripts/dedup.py URL --cycle CYCLE` shows existing candidates. Merge sources for the same requisition into its existing row. Keep its application history. A distinct live requisition or cycle may have a new record beside a closed, rejected, withdrawn or previously submitted row. Reused URLs and same-cycle terminal rows require evidence of reopening or a new requisition and a deliberate user decision. Keep screened-out items screened unless the underlying facts change. Never mass-reopen rejections.

Prioritize by the user's target roles, deadlines, relevant skill fit, application readiness and preferences. For example, a student may prioritize paid term-time roles and set a separate confirmed-pay threshold for summer jobs. Estimated or ambiguous pay cannot satisfy a confirmed-pay rule. Sorting never changes eligibility. Use a separate record per requisition.
