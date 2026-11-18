# Career Search

An agent skill and private dashboard for finding jobs, tailoring resumes, and keeping track of applications and referrals. Use the dashboard in a browser or in its Electron desktop window. Both read the same local workspace.

## Start with your resume

You need Python 3.10 or later and a browser. An agent is optional for tracking jobs and required for the guided resume and research workflows.

```sh
git clone https://github.com/Thespaceblade/career-search-skill.git
cd career-search-skill
python3 scripts/setup.py --resume /path/to/your/resume.pdf
python3 scripts/dashboard.py
```

On Windows, use `py -3` in place of `python3` if needed. The resume flag is optional. You can put your resume in `workspace/resume/` later. Open the address printed in the terminal and use the **Workspace** tab to enter your preferences.

Open the repository folder in your agent and say **“Use the career-search skill to set up my profile from my resume. Ask me what else you need.”** The agent can fill in the profile, experience bank and project bank from your resume and double-check any missing facts. A resume, target roles, locations and availability are enough to start. Add graduation, work authorization or compensation preferences when they matter to your search.

Codex can discover the repo skill under `.agents/skills/`. In other agents, point to [.agents/skills/career-search/SKILL.md](.agents/skills/career-search/SKILL.md) explicitly or install that folder in the agent's skill directory. Keep this repository as the working directory so the skill can use the scripts and templates.

## What you can do

- **Job search** has overview, urgent queue, search and filters, board, list, outstanding actions, and a draggable application flow chart. Add a role by hand or ask your agent to package a specific posting.
- **Networking** tracks company contacts, conversation notes, independent referral and meeting states, drafts, and follow-up dates. **Analytics** shows applications and job listings over time. **Workspace** contains the profile, source status and shared activity.
- **Discovery** reads configured public ATS boards, SimplifyJobs feeds, and private CSV, JSON or XLSX exports. Put your sources in `workspace/sources.json` using [examples](templates/sources.example.json), then run `python3 scripts/sources.py`. The results go into a review queue. See [source setup](.agents/skills/career-search/references/sources.md) for the fields required by each adapter.
- **Resume packages** include the posting, validated resume PDF, optional LaTeX source, and optional cover letter or short answers. To use the PDF validator, install Poppler. To build the included LaTeX template, also install a TeX distribution with pdfLaTeX. See the [tailoring workflow](.agents/skills/career-search/references/resume.md).
- **Private connectors** are optional. Bring your own agent connections or exports for mail, LinkedIn, school boards, and community postings. The [Work at a Startup connector](https://github.com/Thespaceblade/waas-mcp) is maintained separately. The [refresh runbook](.agents/skills/career-search/references/refresh.md) includes an optional scheduler prompt. Sending messages and submitting applications are user-authorized actions.

## Desktop window

With a supported Node.js release and Python on your path, run:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

The desktop app starts and stops its own localhost server. It adds native resume reveal and drag controls for workspace PDF or DOCX files. Set `CAREER_PYTHON` if Python is installed under a different command. The browser dashboard needs no npm install.

## Private data and backups

The public checkout starts empty. Git ignores the entire `workspace/` directory, including imported resumes, contacts, profile and application history. Run the dashboard on your own computer and keep private exports and authentication material out of the repository. To save a private backup, run `python3 scripts/backup.py /path/to/career-backup.zip`. To restore, extract its `workspace/` into a clean clone or merge it with your existing files.

This repository carries the original dashboard views and reusable workflows with configurable filters, paths and sources. Personal account sessions, employer files, private data and source snapshots stay with their owners. See the [skill references](.agents/skills/career-search/references/) for the complete workflow guide. Public ATS references are available from [Greenhouse](https://docs.greenhouse.io/job-board.html), [Lever](https://github.com/lever/postings-api), and [Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api). Chart.js and its bundled color library have their own [license notices](dashboard/vendor/).
