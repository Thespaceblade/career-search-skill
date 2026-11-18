"use strict";

const byId = id => document.getElementById(id);
let workspace = { jobs: [], contacts: [], profile: {}, sources: [], activity: [] };
let editingJob = null;
let editingContact = null;
let lastRequest = 0;

function safeLink(value) {
  try {
    const url = new URL(value);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) {
      return escapeHTML(url.href);
    }
  } catch {}
  return "";
}

function reportError(error) {
  byId("notice").textContent = error.message;
}

async function api(path, data) {
  const options = data ? {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(data),
  } : {};
  const response = await fetch("/api/" + path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Workspace request failed.");
  return payload;
}

async function loadWorkspace() {
  const request = ++lastRequest;
  try {
    const next = await api("workspace");
    if (request !== lastRequest) return;
    workspace = next;
    JOBS.splice(0, JOBS.length, ...workspace.jobs);
    renderWorkspace();
    byId("notice").textContent = "";
  } catch (error) {
    reportError(error);
  }
}

function renderWorkspace() {
  updateButtonCounts();
  renderBoard();
  renderList();
  if (byId("viewFlow").style.display !== "none") renderFlow();
  renderPage();
  renderOverview();
  renderNetworking();
  renderAnalytics();
  byId("resumeCount").textContent = `${workspace.resumeCount} resume file(s) in your workspace.`;
  const profile = byId("profileForm");
  if (!profile.matches(":focus-within") && !profile.dataset.dirty) {
    for (const field of profile.elements) {
      if (field.name) field.value = String(workspace.profile[field.name] || "").slice(0, field.type === "month" ? 7 : undefined);
    }
  }
  byId("activityRows").innerHTML = workspace.activity.map(event =>
    row([localDate(event.at), event.scope, event.summary])).join("");
  const scan = workspace.discovery;
  byId("discoverySummary").textContent = scan?.checked
    ? `Last import ${localDate(scan.checked)} · ${scan.count} candidates · ${scan.errors} source errors` : "";
  byId("sourceList").innerHTML = workspace.sources.map(source =>
    `<li>${escapeHTML(source.company || source.board || source.kind)} &middot; ${escapeHTML(source.kind)}</li>`).join("")
    || "<li>No feeds configured.</li>";
}

function localDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "";
}

function row(values, attrs = "") {
  return `<tr ${attrs}>${values.map(value => `<td>${escapeHTML(value)}</td>`).join("")}</tr>`;
}

function replaceRows(id, body) {
  const table = byId(id);
  const previous = table.querySelector("tbody[data-rendered]");
  if (previous) previous.remove();
  const node = table.createTBody();
  node.dataset.rendered = "";
  node.innerHTML = body;
}

function renderOverview() {
  const ready = JOBS.filter(job => effectiveStatus(job) === "not_applied");
  const applied = JOBS.filter(effectiveApplied);
  const startup = ready.filter(job => job.source === "yc");
  const tasks = JOBS.filter(job => (job.action || job.status === "action_required" || job.status === "assessment")
    && !["closed", "withdrawn", "rejected", "screened_out"].includes(job.status));
  const interviews = JOBS.filter(job => job.status === "interview");
  const format = (job, category) => row([job.company, job.role, job.action || job.deadline || STATUS_LABELS[job.status] || "Ready"],
    category ? `data-cat="${category}"` : "");
  replaceRows("outstandingTable", tasks.map(job => format(job, "app")).join("")
    + interviews.map(job => format(job, "interview")).join("")
    + startup.map(job => format(job, "waas")).join(""));
  for (const [category, entries] of [["app", tasks], ["interview", interviews], ["waas", startup]]) {
    byId("outCount-" + category).textContent = entries.length ? `(${entries.length})` : "";
  }
  const selected = document.querySelector('button[id^="outChip-"].active');
  filterOutstanding(selected ? selected.id.replace("outChip-", "") : "app");
  replaceRows("startupBacklog", startup.map(job => format(job)).join(""));
  replaceRows("recentJobs", [...applied].sort((a, b) =>
    String(b.updatedAt || b.date).localeCompare(String(a.updatedAt || a.date))).slice(0, 12)
    .map(job => row([job.company, job.role, STATUS_LABELS[job.status]])).join(""));
  pipelineChart.data.datasets[0].data = [JOBS.length, JOBS.filter(job => job.resumePath).length, ready.length, applied.length];
  pipelineChart.update("none");
}

function renderAnalytics() {
  const weeks = new Map();
  const months = new Map();
  const days = Array(7).fill(0);
  const companies = new Map();
  function countWeek(value, index) {
    if (!value) return;
    const date = new Date(value + "T12:00:00Z");
    if (!Number.isFinite(date.getTime())) return;
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
    const key = date.toISOString().slice(0, 10);
    if (!weeks.has(key)) weeks.set(key, [0, 0]);
    weeks.get(key)[index]++;
  }
  for (const job of JOBS) {
    const company = companies.get(job.company) || [0, 0];
    company[0]++;
    if (effectiveApplied(job)) company[1]++;
    companies.set(job.company, company);
    countWeek(job.date, 0);
    countWeek(job.stageDates?.applied, 1);
    if (job.date) {
      const date = new Date(job.date + "T12:00:00Z");
      if (Number.isFinite(date.getTime())) {
        const key = job.date.slice(0, 7);
        months.set(key, (months.get(key) || 0) + 1);
        days[date.getUTCDay()]++;
      }
    }
  }
  const weekLabels = [...weeks.keys()].sort();
  const monthLabels = [...months.keys()].sort();
  function update(chart, labels, datasets) {
    chart.data.labels = labels;
    datasets.forEach((data, index) => { chart.data.datasets[index].data = data; });
    chart.update("none");
  }
  update(analyticsWeeklyChartInstance, weekLabels, [weekLabels.map(label => weeks.get(label)[0]), weekLabels.map(label => weeks.get(label)[1])]);
  update(analyticsMonthChartInstance, monthLabels, [monthLabels.map(label => months.get(label))]);
  update(analyticsDowChartInstance, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], [days]);
  byId("companyRows").innerHTML = [...companies.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 20)
    .map(([company, counts]) => row([company, ...counts])).join("");
}

function renderNetworking() {
  const linked = workspace.contacts.filter(contact => contact.channel === "linkedin");
  const email = workspace.contacts.filter(contact => contact.channel === "email");
  const cards = (contacts, channel) => {
    const groups = Map.groupBy ? Map.groupBy(contacts, contact => contact.company) : contacts.reduce((map, contact) => {
      map.set(contact.company, [...(map.get(contact.company) || []), contact]);
      return map;
    }, new Map());
    return [...groups.entries()].map(([company, group]) =>
      `<section class="${channel === "ref" ? "referral" : "recruiter"}-company-card"
       data-search="${escapeHTML([company, ...group.map(contact => contact.name)].join(" ").toLowerCase())}"
       data-${channel}-state="${escapeHTML(group.map(contact => contact.state).join(" "))}">
       <h3>${escapeHTML(company)}</h3>
       ${group.map(contact => `<p><button class="chip-btn" data-id="${escapeHTML(contact.id)}" onclick="openContact(this.dataset.id)">${escapeHTML(contact.name)}</button>
         ${escapeHTML(contact.state?.replaceAll("_", " "))}</p>
         <p>${[contact.conversation, contact.meeting, contact.referral, contact.mechanism, contact.notes].filter(Boolean).map(escapeHTML).join(" · ")}</p>
         ${safeLink(contact.url) ? `<a href="${safeLink(contact.url)}" target="_blank" rel="noopener">Open thread</a>` : ""}
         ${contact.draft || contact.due ? `<p>${escapeHTML(contact.draft)} ${escapeHTML(contact.due)}</p>` : ""}`).join("")}</section>`).join("")
      || "<p>No contacts recorded yet.</p>";
  };
  byId("networkCount").textContent = `${linked.length} LinkedIn contact(s), ${email.length} email contact(s)`;
  byId("referralCompanyGrid").innerHTML = cards(linked, "ref");
  byId("recruiterEmailGrid").innerHTML = cards(email, "email");
  if (outreachChartInstance) {
    const groups = [["sent", "follow_up_due"], ["bounced"], ["replied", "reply"], ["resume_forwarded"], ["closed"]];
    outreachChartInstance.data.datasets[0].data = groups.map(group =>
      email.filter(contact => group.includes(contact.state)).length);
    outreachChartInstance.update("none");
  }
  const states = {reply: "reply", sent: "waiting", follow_up_due: "followup", offered: "referral", check: "check"};
  replaceRows("linkedinConversationTable", linked.filter(contact => states[contact.state]).map(contact =>
    row([contact.name, contact.conversation, contact.state.replaceAll("_", " "), contact.draft, contact.due],
      `data-li-state="${states[contact.state]}"`)).join(""));
  const selected = document.querySelector('button[id^="liChip-"].active');
  filterLinkedinInbox(selected ? selected.id.replace("liChip-", "") : "all");
  filterReferralDesk();
  filterRecruiterEmails();
}

function openAddJobModal(job = null) {
  editingJob = job;
  const values = {
    addJobCompany: job?.company, addJobRole: job?.role, addJobLocation: job?.location,
    addJobLink: job?.url, addJobStatus: job?.status || "not_applied", addJobNote: job?.note,
    jobTerm: job?.term, jobCycle: job?.cycle, jobPay: job?.pay, jobAction: job?.action,
    jobResume: job?.resumePath, jobDeadline: job?.deadline,
  };
  for (const [id, value] of Object.entries(values)) byId(id).value = value || "";
  byId("jobUrgent").checked = !!job?.urgent;
  byId("jobFormTitle").textContent = job ? "Edit job" : "Add a job";
  byId("addJobSubmitBtn").textContent = job ? "Save changes" : "Add job";
  byId("addJobError").textContent = "";
  byId("addJobBackdrop").classList.add("open");
  byId("addJobCompany").focus();
}

function editJob(id) {
  const job = JOBS.find(row => row.id === id);
  if (job) {
    closeDetail();
    openAddJobModal(job);
  }
}

function closeAddJobModal() {
  byId("addJobBackdrop").classList.remove("open");
}

function closeAddJobBackdrop(event) {
  if (event.target.id === "addJobBackdrop") closeAddJobModal();
}

async function saveJob(data) {
  const current = JOBS.find(row => row.id === data.id);
  await api("job", {expected: current?.updatedAt, ...data});
  await loadWorkspace();
}

async function submitAddJob(event) {
  event.preventDefault();
  const fields = {
    company: "addJobCompany", title: "addJobRole", location: "addJobLocation",
    url: "addJobLink", status: "addJobStatus", notes: "addJobNote", term: "jobTerm",
    cycle: "jobCycle", pay: "jobPay", action: "jobAction", resumePath: "jobResume", deadline: "jobDeadline",
  };
  const data = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, byId(id).value.trim()]));
  byId("addJobSubmitBtn").disabled = true;
  try {
    await saveJob({...data, id: editingJob?.id, expected: editingJob?.updatedAt, urgent: byId("jobUrgent").checked});
    closeAddJobModal();
  } catch (error) {
    byId("addJobError").textContent = error.message;
  } finally {
    byId("addJobSubmitBtn").disabled = false;
  }
}

function openSettingsModal() { switchPage("sharedbrain"); }

function openContact(id) {
  editingContact = id;
  const current = workspace.contacts.find(contact => contact.id === id);
  const form = byId("contactForm");
  form.reset();
  if (current) {
    for (const field of form.elements) {
      if (field.name) field.value = current[field.name] || "";
    }
  }
  byId("contactStatus").textContent = "";
  byId("contactBackdrop").classList.add("open");
  form.elements.company.focus();
}

function closeContact() { byId("contactBackdrop").classList.remove("open"); }

document.addEventListener("DOMContentLoaded", () => {
  const statusSelect = byId("addJobStatus");
  statusSelect.replaceChildren(...STATUS_ORDER.map(status =>
    new Option(STATUS_LABELS[status] || "NOT SUBMITTED", status)));
  for (const [formId, endpoint, statusId] of [
    ["profileForm", "profile", "profileStatus"], ["contactForm", "contact", "contactStatus"],
  ]) {
    const form = byId(formId);
    form.oninput = () => { form.dataset.dirty = "true"; };
    form.onsubmit = async event => {
      event.preventDefault();
      const button = form.querySelector("button[type=submit]");
      button.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        if (endpoint === "contact") data.id = editingContact;
        await api(endpoint, data);
        delete form.dataset.dirty;
        byId(statusId).textContent = "Saved";
        if (endpoint === "contact") closeContact();
        await loadWorkspace();
      } catch (error) {
        byId(statusId).textContent = error.message;
      } finally {
        button.disabled = false;
      }
    };
  }
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeAddJobModal();
      closeContact();
      closeDetail();
    }
  });
  setInterval(() => {
    if (!document.hidden && !document.querySelector(".detail-backdrop.open")) loadWorkspace();
  }, 5000);
});
