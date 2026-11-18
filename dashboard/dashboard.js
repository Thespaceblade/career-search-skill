
const STATUS_LABELS = {
  not_applied: null,
  submitted: 'SUBMITTED',
  screen: 'SCREEN',
  assessment: 'ASSESSMENT',
  interview: 'INTERVIEW / NEXT STEPS',
  rejected: 'REJECTED',
  offer: 'OFFER',
  in_progress: 'IN PROGRESS',
  action_required: 'ACTION NEEDED',
  duplicate: 'DUPLICATE',
  unclear: 'UNCLEAR',
  closed: 'CLOSED',
  withdrawn: 'WITHDRAWN',
  screened_out: 'SCREENED OUT'
};

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const SOURCE_LABELS = { simplify: 'SimplifyJobs', direct: 'Direct company ATS', yc: 'Work at a Startup (YC)' };
const ATS_LABELS = { workday: 'Workday ATS', ashby: 'Ashby ATS', greenhouse: 'Greenhouse ATS', lever: 'Lever ATS' };

function sourceLabel(job) {
  if (job && job.source === 'direct' && ATS_LABELS[job.ats]) return ATS_LABELS[job.ats];
  return SOURCE_LABELS[job && job.source] || (job && job.source) || 'Unknown source';
}
function termGroup(term) {
  if (!term) return 'yearround';
  if (term.startsWith('Summer')) return 'summer';
  if (term.startsWith('Fall') || term.startsWith('Winter') || term.startsWith('Spring')) return 'fallwinter';
  return 'yearround';
}
const OVERRIDES_KEY = 'career-search-layout-v1';
const STATUS_OVERRIDES_SEED = {};
const JOBS = [];

function jobKey(job) { return job.id; }
const jobKeyLegacy = jobKey;
function statusOverrideFor(job) {
  const key = jobKey(job);
  if (overrides.statusOverride[key]) return overrides.statusOverride[key];
  return overrides.statusOverride[jobKeyLegacy(job)] || null;
}
function isHiddenJob(job) {
  const key = jobKey(job);
  return overrides.hidden.includes(key) || overrides.hidden.includes(jobKeyLegacy(job));
}
function quantReachedInterviewOrOffer(job) {
  if (!job) return false;
  const status = effectiveStatus(job);
  if (status === 'interview' || status === 'offer') return true;
  const dates = effectiveStageDates(job);
  return !!(dates.interview || dates.offer);
}
function isBoardHiddenJob(job) {
  if (isHiddenJob(job)) return true;
  if (!(job && job.quantHidden)) return false;
  return !quantReachedInterviewOrOffer(job);
}
function isDemotedJob(job) {
  const key = jobKey(job);
  return overrides.demoted.includes(key) || overrides.demoted.includes(jobKeyLegacy(job));
}

function loadOverrides() {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return { hidden: [], demoted: [], order: {}, statusOverride: { ...STATUS_OVERRIDES_SEED }, stageDates: {} };
    const parsed = JSON.parse(raw);
    return {
      hidden: parsed.hidden || [],
      demoted: parsed.demoted || [],
      order: parsed.order || {},
      statusOverride: {},
      stageDates: parsed.stageDates || {}
    };
  } catch (e) {
    return { hidden: [], demoted: [], order: {}, statusOverride: { ...STATUS_OVERRIDES_SEED }, stageDates: {} };
  }
}

function saveOverrides() {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

let overrides = loadOverrides();
let currentRenderedOrder = [];

function isHidden(key) { return overrides.hidden.includes(key); }
function isDemoted(key) { return overrides.demoted.includes(key); }
const STATUS_ORDER = ['not_applied', 'submitted', 'screen', 'assessment', 'interview', 'offer', 'action_required', 'in_progress', 'unclear', 'duplicate', 'rejected', 'closed', 'withdrawn', 'screened_out'];
const ACTIVE_PROCESS_STATUSES = ['assessment', 'action_required', 'screen', 'interview'];
function effectiveStatus(job) {
  return statusOverrideFor(job) || job.status;
}
function effectiveApplied(job) {
  return job.applied;
}
function effectiveUrgent(job) {
  return job.urgent && effectiveStatus(job) === 'not_applied';
}
function boardColumnKey(job) {
  const s = effectiveStatus(job);
  if (s === 'assessment') return 'screen';
  if (s === 'action_required') {
    const blob = `${job.action || ''} ${job.note || ''}`;
    if (/assessment|hackerrank|codesignal|hirevue|pymetrics|\boa\b|online assess|coding (test|challenge)|zap-n/i.test(blob)) {
      return 'screen';
    }
  }
  return s;
}
function urgentRank(job) {
  return ({ standard: 0, remote_offseason: 1, offseason: 2 })[job.urgentPriority] ?? 3;
}
function urgentPriorityPill(job) {
  if (!effectiveUrgent(job)) return '';
  if (job.urgentPriority === 'remote_offseason') return '<span class="offseason-pill remote">REMOTE OFF-SEASON</span>';
  if (job.urgentPriority === 'offseason') return '<span class="offseason-pill">OFF-SEASON</span>';
  return '';
}
function todayISODate() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function primaryDateKeyForStatus(status) {
  if (status === 'offer') return 'offer';
  if (status === 'interview') return 'interview';
  if (status === 'assessment') return 'assessment';
  if (status === 'screen' || status === 'action_required') return 'screen';
  if (status === 'rejected') return 'rejected';
  if (['submitted', 'in_progress', 'unclear'].includes(status)) return 'applied';
  return null;
}
function effectiveStageDates(job) {
  if (!job) return {};
  const key = jobKey(job);
  return { ...(job.stageDates || {}), ...(overrides.stageDates[key] || {}) };
}
function stampStageDatesForStatus(job, newStatus) {
  const today = todayISODate();
  const dates = { ...effectiveStageDates(job) };
  if (newStatus !== 'not_applied' && !dates.applied) {
    dates.applied = (job && job.date) || today;
  }
  const primary = primaryDateKeyForStatus(newStatus);
  if (primary && !dates[primary]) dates[primary] = today;
  if (primary === 'offer') {
    if (!dates.interview) dates.interview = today;
    if (!dates.screen && !dates.assessment) dates.screen = today;
  } else if (primary === 'interview') {
    if (!dates.screen && !dates.assessment) dates.screen = today;
  } else if (primary === 'assessment' || primary === 'screen') {
  }
  return dates;
}
async function setStatus(key, status) {
  try {
    await saveJob({ id: key, status });
    if (document.getElementById('detailBackdrop').classList.contains('open')) openDetail(key);
  } catch (error) {
    reportError(error);
    if (document.getElementById('detailBackdrop').classList.contains('open')) openDetail(key);
  }
}
function jobKeyFromEl(el) {
  if (!el) return '';
  return el.getAttribute('data-jobkey') || el.dataset.jobkey || '';
}
function setStatusFromSelect(el) {
  const key = jobKeyFromEl(el);
  if (key) setStatus(key, el.value);
}
function hideJobFromEl(el) {
  const key = jobKeyFromEl(el);
  if (key) { hideJob(key); closeDetail(); }
}
function openJobFolderFromEl(el) {
  const key = jobKeyFromEl(el);
  if (key) openJobFolder(key);
}
function startResumeDragFromEl(el, event) {
  const key = jobKeyFromEl(el);
  if (key) startResumeDrag(key, event);
}

function hideJob(key) {
  if (confirm('Mark this application as withdrawn?')) setStatus(key, 'withdrawn');
}
function restoreHidden(key) {
  overrides.hidden = overrides.hidden.filter(k => k !== key);
  saveOverrides();
  renderPage();
  updateButtonCounts();
}
async function demoteUrgent(id) {
  try { await saveJob({ id, urgent: false }); } catch (error) { reportError(error); }
}
function restoreDemoted(id) {
  saveJob({ id, urgent: true }).catch(reportError);
}
function orderStoreKey() {
  const sortPart = currentPageKey === 'not_applied' ? ('::' + currentSort) : '';
  return currentPageKey + '::' + currentSourceFilter + '::' + currentAtsFilter + '::' + currentTermFilter + '::' + currentTailorFilter + sortPart;
}

function moveJob(key, delta) {
  const idx = currentRenderedOrder.indexOf(key);
  const newIdx = idx + delta;
  if (idx === -1 || newIdx < 0 || newIdx >= currentRenderedOrder.length) return;
  const arr = currentRenderedOrder.slice();
  [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
  overrides.order[orderStoreKey()] = arr;
  saveOverrides();
  renderPage();
}

let managePanelOpen = false;
function toggleManagePanel() {
  managePanelOpen = !managePanelOpen;
  renderManagePanel();
}

function renderManagePanel() {
  const bar = document.getElementById('manageBar');
  const panel = document.getElementById('managePanel');
  const hiddenJobs = JOBS.filter(j => isHiddenJob(j));
  const demotedJobs = JOBS.filter(j => isDemotedJob(j));
  const total = hiddenJobs.length + demotedJobs.length;
  bar.textContent = total > 0
    ? (managePanelOpen ? '▲ Hide panel' : `⚙ ${hiddenJobs.length} removed, ${demotedJobs.length} marked not-urgent — manage`)
    : '';
  if (!managePanelOpen || total === 0) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  const rows = [];
  demotedJobs.forEach(j => {
    const key = jobKey(j);
    rows.push(`<div class="manage-row"><span class="mrinfo">${escapeHTML(j.company)} — ${escapeHTML(j.role)} <span class="mrtag">(marked not urgent)</span></span><button class="mini-btn" data-restore-demoted="${escapeHTML(key)}">Restore to urgent</button></div>`);
  });
  hiddenJobs.forEach(j => {
    const key = jobKey(j);
    rows.push(`<div class="manage-row"><span class="mrinfo">${escapeHTML(j.company)} — ${escapeHTML(j.role)} <span class="mrtag">(removed)</span></span><button class="mini-btn" data-restore-hidden="${escapeHTML(key)}">Restore</button></div>`);
  });
  panel.innerHTML = rows.join('');
  panel.querySelectorAll('[data-restore-hidden]').forEach(btn => {
    btn.addEventListener('click', () => restoreHidden(btn.dataset.restoreHidden));
  });
  panel.querySelectorAll('[data-restore-demoted]').forEach(btn => {
    btn.addEventListener('click', () => restoreDemoted(btn.dataset.restoreDemoted));
  });
}

function openJobFolder(key) {
  const job = JOBS.find(j => jobKey(j) === key);
  if (!job || !job.resumePath || !window.desktop) return;
  window.desktop.reveal(job.resumePath).then(res => {
    if (!res || !res.ok) {
      alert((res && res.error) || 'Could not open that resume folder.');
    }
  });
}

function startResumeDrag(key, event) {
  const job = JOBS.find(j => jobKey(j) === key);
  if (!job || !job.resumePath || !window.desktop) return;
  event.preventDefault();
  window.desktop.drag(job.resumePath);
}

function jobCardHTML(job, idx, total) {
  const key = jobKey(job);
  const linkHTML = job.link ? `<a class="applylink" href="${safeLink(job.link)}" target="_blank" rel="noopener">Open posting &#8594;</a>` : '';
  const folderBtnHTML = (window.desktop && job.resumePath)
    ? `<button class="mini-btn" data-jobkey="${escapeHTML(key)}" onclick="openJobFolderFromEl(this)" title="Reveal resume">&#128193;</button>`
    : '';
  const dragBtnHTML = (window.desktop && job.resumePath)
    ? `<button class="mini-btn" draggable="true" data-jobkey="${escapeHTML(key)}" ondragstart="startResumeDragFromEl(this, event)" title="Drag resume file into another app">&#128196;</button>`
    : '';
  const actionBtnHTML = job.actionLink ? `<a class="applylink action-link" href="${safeLink(job.actionLink)}" target="_blank" rel="noopener">Complete task &#8594;</a>` : '';
  const compactAction = job.action
    ? job.action.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').replace(/\s*[—–-]\s*$/, '').trim()
    : '';
  const actionHTML = compactAction
    ? `<div class="action-banner" title="${escapeHTML(job.action)}">&#9888; ${escapeHTML(compactAction.length > 105 ? compactAction.slice(0, 102) + '...' : compactAction)}</div>`
    : '';
  const status = effectiveStatus(job);
  const statusLabel = STATUS_LABELS[status] || null;
  const payText = job.pay || 'Pay not listed';
  const isEstimate = payText.startsWith('Est.');
  const payBadge = `<span class="pay-badge${isEstimate ? ' est' : ''}" title="${isEstimate ? 'Estimated — not explicitly stated in the posting' : 'From the posting'}">${escapeHTML(payText)}</span>`;
  const pills = (effectiveUrgent(job) ? '<span class="urgent-pill">URGENT</span>' : '')
    + urgentPriorityPill(job)
    + (job.tailorMode === 'needs_hypertailor' ? '<span class="urgent-pill" style="background:#7c3aed">HYPERTAILOR QUEUE</span>' : '')
    + (job.tailorMode === 'hypertailored' ? '<span class="status-pill submitted">HYPERTAILORED</span>' : '')
    + payBadge
    + (statusLabel ? `<span class="status-pill ${status}">${statusLabel}</span>` : '');
  const atTop = idx === 0;
  const atBottom = idx === total - 1;
  const notUrgentBtn = (currentPageKey === 'urgent')
    ? `<button class="mini-btn" data-demote="${escapeHTML(key)}">Not urgent</button>`
    : '';
  const actionsHTML = `
      <div class="card-actions">
        <button class="mini-btn" data-move="-1" data-key="${escapeHTML(key)}" ${atTop ? 'disabled' : ''}>&#9650;</button>
        <button class="mini-btn" data-move="1" data-key="${escapeHTML(key)}" ${atBottom ? 'disabled' : ''}>&#9660;</button>
        ${notUrgentBtn}
        ${folderBtnHTML}
        ${dragBtnHTML}
        <button class="mini-btn danger" data-hide="${escapeHTML(key)}" title="Mark withdrawn">&#10005;</button>
      </div>`;
  return `
    <div class="job-card" data-open-detail="${escapeHTML(key)}">
      <div class="titlerow">${companyIconHTML(job, 22)}<span class="company">${escapeHTML(job.company)}</span>${pills}</div>
      <div class="role">${escapeHTML(job.role)}</div>
      <div class="meta">${escapeHTML(job.location || '')}${job.location ? ' &middot; ' : ''}Added ${escapeHTML(formatShortDate(job.date) || job.date || 'unknown')} &middot; ${escapeHTML(sourceLabel(job))} &middot; ${escapeHTML(job.term || '')}</div>
      ${actionHTML}
      ${actionBtnHTML}
      ${linkHTML}
      ${actionsHTML}
    </div>`;
}

const FILTERS = {
  all: { title: 'All jobs', fn: () => JOBS },
  not_applied: { title: 'Not applied yet', fn: () => JOBS.filter(j => effectiveStatus(j) === 'not_applied') },
  urgent: { title: 'Urgent', fn: () => JOBS.filter(j => effectiveUrgent(j)) },
  submitted: { title: 'Submitted / in progress', fn: () => JOBS.filter(j => effectiveApplied(j)) }
};

let currentSort = 'recency'; // 'recency' | 'value' -- only meaningful on the not_applied page
function valueScore(job) {
  return (effectiveUrgent(job) ? 40 : 0) + (job.bestPick ? 15 : 0)
    + (job.fullRemote ? 6 : 0) + (job.tailorMode === 'hypertailored' ? 5 : 0);
}
function sortChipsHTML() {
  if (currentPageKey !== 'not_applied') return '';
  const chips = [
    { key: 'recency', label: 'Date added' },
    { key: 'value', label: 'By value' }
  ];
  return chips.map(c => `<button class="chip-btn${c.key === currentSort ? ' active' : ''}" onclick="setSortMode('${c.key}')">${c.label}</button>`).join('');
}

function compareDateAddedDesc(a, b) {
  return (b.date || '').localeCompare(a.date || '');
}

function formatAddedHeading(iso) {
  if (!iso) return 'Date added unknown';
  const d = parseJobDate({ date: iso });
  if (!d) return iso;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function setSortMode(mode) {
  currentSort = mode;
  renderPage();
}

let currentPageKey = 'all';
let currentSourceFilter = 'all';
let currentAtsFilter = 'all';
let currentTermFilter = 'all';
let currentTailorFilter = 'all';

function sourceChipsHTML() {
  const chips = [
    { key: 'all', label: 'All sources' },
    { key: 'simplify', label: 'SimplifyJobs' },
    { key: 'direct', label: 'Direct company ATS' },
    { key: 'yc', label: 'Work at a Startup (YC)' }
  ];
  return chips.map(c => `<button class="chip-btn${c.key === currentSourceFilter ? ' active' : ''}" onclick="setSourceFilter('${c.key}')">${c.label}</button>`).join('');
}

function setSourceFilter(key) {
  currentSourceFilter = key;
  renderPage();
}

function atsChipsHTML() {
  const chips = [
    { key: 'all', label: 'All platforms' },
    { key: 'workday', label: 'Workday' },
    { key: 'ashby', label: 'Ashby' },
    { key: 'greenhouse', label: 'Greenhouse' },
    { key: 'lever', label: 'Lever' },
    { key: 'other', label: 'Other' }
  ];
  return chips.map(c => `<button class="chip-btn${c.key === currentAtsFilter ? ' active' : ''}" onclick="setAtsFilter('${c.key}')">${c.label}</button>`).join('');
}

function setAtsFilter(key) {
  currentAtsFilter = key;
  renderPage();
}

function termChipsHTML() {
  const chips = [
    { key: 'all', label: 'All terms' },
    { key: 'summer', label: 'Summer' },
    { key: 'fallwinter', label: 'Off-season · Fall / Winter / Spring' },
    { key: 'yearround', label: 'Year-round / rolling' }
  ];
  return chips.map(c => `<button class="chip-btn${c.key === currentTermFilter ? ' active' : ''}" onclick="setTermFilter('${c.key}')">${c.label}</button>`).join('');
}

function setTermFilter(key) {
  currentTermFilter = key;
  renderPage();
}

function tailorChipsHTML() {
  const chips = [
    { key: 'all', label: 'All tailor states' },
    { key: 'needs_hypertailor', label: 'Needs hypertailor' },
    { key: 'hypertailored', label: 'Hypertailored' },
    { key: 'untailored', label: 'Untailored' },
    { key: 'general', label: 'General reuse' }
  ];
  return chips.map(c => `<button class="chip-btn${c.key === currentTailorFilter ? ' active' : ''}" onclick="setTailorFilter('${c.key}')">${c.label}</button>`).join('');
}

function setTailorFilter(key) {
  currentTailorFilter = key;
  renderPage();
}

function renderPage() {
  const filter = FILTERS[currentPageKey];
  let items = filter.fn().slice();
  if (currentSourceFilter !== 'all') {
    items = items.filter(j => j.source === currentSourceFilter);
  }
  if (currentAtsFilter !== 'all') {
    items = items.filter(j => (j.ats || 'other') === currentAtsFilter);
  }
  if (currentTermFilter !== 'all') {
    items = items.filter(j => termGroup(j.term) === currentTermFilter);
  }
  if (currentTailorFilter !== 'all') {
    items = items.filter(j => (j.tailorMode || 'untailored') === currentTailorFilter);
  }
  items = items.filter(j => !isBoardHiddenJob(j));
  const datePinned = (currentPageKey === 'urgent' || currentPageKey === 'not_applied') && currentSort !== 'value';
  if (currentPageKey === 'not_applied' && currentSort === 'value') {
    items.sort((a, b) => {
      const diff = valueScore(b) - valueScore(a);
      if (diff !== 0) return diff;
      return compareDateAddedDesc(a, b);
    });
  } else if (datePinned) {
    items.sort(compareDateAddedDesc);
  } else {
    items.sort((a, b) => {
      if (!!a.action !== !!b.action) return a.action ? -1 : 1;
      return compareDateAddedDesc(a, b);
    });
  }
  const savedOrder = overrides.order[orderStoreKey()];
  if (!datePinned && savedOrder && savedOrder.length) {
    const byKey = new Map(items.map(j => [jobKey(j), j]));
    const ordered = [];
    savedOrder.forEach(k => { if (byKey.has(k)) { ordered.push(byKey.get(k)); byKey.delete(k); } });
    byKey.forEach(j => ordered.push(j)); // any items not yet in the saved order (new postings) go last
    items = ordered;
  }
  currentRenderedOrder = items.map(jobKey);
  document.getElementById('pageTitle').textContent = filter.title;
  document.getElementById('pageCount').textContent = items.length + (items.length === 1 ? ' job' : ' jobs');
  document.getElementById('sourceChips').innerHTML = sourceChipsHTML();
  document.getElementById('atsChips').innerHTML = atsChipsHTML();
  document.getElementById('termChips').innerHTML = termChipsHTML();
  document.getElementById('tailorChips').innerHTML = tailorChipsHTML();
  document.getElementById('sortChips').innerHTML = sortChipsHTML();
  const list = document.getElementById('jobList');
  const empty = document.getElementById('pageEmpty');
  if (items.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = (currentSourceFilter !== 'all' || currentAtsFilter !== 'all' || currentTermFilter !== 'all' || currentTailorFilter !== 'all') ? 'No jobs match this filter combination yet.' : 'Nothing here right now.';
  } else {
    empty.style.display = 'none';
    const dateCounts = {};
    if (datePinned) {
      items.forEach(j => {
        const d = j.date || '';
        dateCounts[d] = (dateCounts[d] || 0) + 1;
      });
    }
    list.innerHTML = items.map((j, i) => {
      let head = '';
      if (datePinned && (i === 0 || (items[i - 1].date || '') !== (j.date || ''))) {
        const n = dateCounts[j.date || ''] || 0;
        head = `<div class="date-group-head">Added ${escapeHTML(formatAddedHeading(j.date))} · ${n} ${n === 1 ? 'role' : 'roles'}</div>`;
      }
      return head + jobCardHTML(j, i, items.length);
    }).join('');
    list.querySelectorAll('[data-move]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); moveJob(btn.dataset.key, parseInt(btn.dataset.move, 10)); });
    });
    list.querySelectorAll('[data-hide]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); hideJob(btn.dataset.hide); });
    });
    list.querySelectorAll('[data-demote]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); demoteUrgent(btn.dataset.demote); });
    });
    list.querySelectorAll('[data-open-folder]').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); openJobFolder(btn.dataset.openFolder); });
    });
    list.querySelectorAll('[data-open-detail]').forEach(card => {
      card.addEventListener('click', () => openDetail(card.dataset.openDetail));
    });
  }
  renderManagePanel();
}

function openPage(key) {
  currentPageKey = key;
  currentSourceFilter = 'all';
  currentAtsFilter = 'all';
  currentTermFilter = 'all';
  currentTailorFilter = 'all';
  currentSort = 'recency';
  managePanelOpen = false;
  renderPage();
  document.getElementById('pageOverlay').classList.add('open');
}
function closePage() {
  document.getElementById('pageOverlay').classList.remove('open');
}

function updateButtonCounts() {
  const visible = JOBS.filter(j => !isBoardHiddenJob(j));
  const counts = {
    all: visible.length,
    not_applied: visible.filter(j => effectiveStatus(j) === 'not_applied').length,
    urgent: visible.filter(j => effectiveUrgent(j)).length,
    submitted: visible.filter(j => effectiveApplied(j)).length
  };
  document.getElementById('btn-num-all').textContent = counts.all;
  document.getElementById('btn-num-not_applied').textContent = counts.not_applied;
  document.getElementById('btn-num-urgent').textContent = counts.urgent;
  document.getElementById('btn-num-submitted').textContent = counts.submitted;
  const urgentBtn = document.getElementById('urgentBtn');
  if (counts.urgent > 0) {
    urgentBtn.setAttribute('data-badge', counts.urgent);
    urgentBtn.classList.add('badge');
  } else {
    urgentBtn.classList.remove('badge');
  }
}
updateButtonCounts();

function filterOutstanding(cat) {
  document.querySelectorAll('#outstandingTable tr[data-cat]').forEach(r => {
    r.style.display = (r.dataset.cat === cat) ? '' : 'none';
  });
  const appBtn = document.getElementById('outChip-app');
  const interviewBtn = document.getElementById('outChip-interview');
  const waasBtn = document.getElementById('outChip-waas');
  if (appBtn) appBtn.classList.toggle('active', cat === 'app');
  if (interviewBtn) interviewBtn.classList.toggle('active', cat === 'interview');
  if (waasBtn) waasBtn.classList.toggle('active', cat === 'waas');
}
filterOutstanding('app');

function filterLinkedinInbox(state) {
  document.querySelectorAll('#linkedinConversationTable tr[data-li-state]').forEach(row => {
    row.style.display = (state === 'all' || row.dataset.liState === state) ? '' : 'none';
  });
  document.querySelectorAll('[id^="liChip-"]').forEach(button => {
    button.classList.toggle('active', button.id === `liChip-${state}`);
  });
}
filterLinkedinInbox('all');

let activeReferralFilter = 'all';
let activeRecruiterFilter = 'all';

function switchNetworkSubpage(subpage) {
  document.getElementById('networkSubpage-linkedin').style.display = subpage === 'linkedin' ? '' : 'none';
  document.getElementById('networkSubpage-email').style.display = subpage === 'email' ? '' : 'none';
  document.getElementById('networkTab-linkedin').classList.toggle('active', subpage === 'linkedin');
  document.getElementById('networkTab-email').classList.toggle('active', subpage === 'email');
}

function setReferralFilter(state) {
  activeReferralFilter = state;
  document.querySelectorAll('[data-ref-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.refFilter === state);
  });
  filterReferralDesk();
}

function filterReferralDesk() {
  const input = document.getElementById('referralCompanySearch');
  const query = input ? input.value.trim().toLowerCase() : '';
  document.querySelectorAll('#referralCompanyGrid .referral-company-card').forEach(card => {
    const stateMatch = activeReferralFilter === 'all' || card.dataset.refState.split(" ").includes(activeReferralFilter);
    const searchMatch = !query || (card.dataset.search || '').includes(query);
    card.style.display = stateMatch && searchMatch ? '' : 'none';
  });
}

function setRecruiterFilter(state) {
  activeRecruiterFilter = state;
  document.querySelectorAll('[data-email-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.emailFilter === state);
  });
  filterRecruiterEmails();
}

function filterRecruiterEmails() {
  const input = document.getElementById('recruiterEmailSearch');
  const query = input ? input.value.trim().toLowerCase() : '';
  document.querySelectorAll('#recruiterEmailGrid .recruiter-company-card').forEach(card => {
    const stateMatch = activeRecruiterFilter === 'all' || card.dataset.emailState.split(" ").includes(activeRecruiterFilter);
    const searchMatch = !query || (card.dataset.search || '').includes(query);
    card.style.display = stateMatch && searchMatch ? '' : 'none';
  });
}

switchNetworkSubpage('linkedin');
filterReferralDesk();
filterRecruiterEmails();

function switchPage(page) {
  document.querySelectorAll('.page-tab').forEach(t => t.classList.toggle('active', t.dataset.page === page));
  document.getElementById('page-jobsearch').style.display = page === 'jobsearch' ? '' : 'none';
  document.getElementById('page-networking').style.display = page === 'networking' ? '' : 'none';
  document.getElementById('page-analytics').style.display = page === 'analytics' ? '' : 'none';
  document.getElementById('page-sharedbrain').style.display = page === 'sharedbrain' ? '' : 'none';
  if (page === 'networking' && typeof outreachChartInstance !== 'undefined' && outreachChartInstance) {
    outreachChartInstance.resize();
  }
  if (page === 'analytics') {
    [analyticsWeeklyChartInstance, analyticsMonthChartInstance, analyticsDowChartInstance].forEach(c => {
      if (c) c.resize();
    });
  }
}

const pipelineCtx = document.getElementById('pipelineChart');
const pipelineChart = new Chart(pipelineCtx, {
  type: 'bar',
  data: {
    labels: ['Postings reviewed', 'Resumes tailored', 'Ready to apply', 'Submitted'],
    datasets: [{
      label: 'Count',
      data: [],
      backgroundColor: ['#c9c4b8', '#b5a98f', '#d9a86c', '#4f7a52'],
      borderRadius: 4
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
});

const outreachCtx = document.getElementById('outreachChart');
const outreachChartInstance = outreachCtx && new Chart(outreachCtx, {
  type: 'doughnut',
  data: {
    labels: ['Awaiting response', 'Bounced', 'Replied', 'Resume forwarded', 'Closed'],
    datasets: [{
      data: [],
      backgroundColor: ['#d9a86c', '#a3312e', '#4f7a52', '#1a4d8f', '#777777']
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
  }
});

const analyticsWeeklyCtx = document.getElementById('analyticsWeeklyChart');
const analyticsWeeklyChartInstance = new Chart(analyticsWeeklyCtx, {
  type: 'line',
  data: {
    labels: [],
    datasets: [
      {
        label: 'Postings logged',
        data: [],
        borderColor: '#c9c4b8',
        backgroundColor: 'rgba(201,196,184,0.25)',
        fill: true,
        tension: 0.25
      },
      {
        label: 'Applications submitted',
        data: [],
        borderColor: '#4f7a52',
        backgroundColor: 'rgba(79,122,82,0.25)',
        fill: true,
        tension: 0.25
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
    scales: {
      y: { beginAtZero: true },
      x: { title: { display: true, text: 'Week of' } }
    }
  }
});

const analyticsMonthCtx = document.getElementById('analyticsMonthChart');
const analyticsMonthChartInstance = new Chart(analyticsMonthCtx, {
  type: 'bar',
  data: {
    labels: [],
    datasets: [{ label: 'Postings logged', data: [], backgroundColor: '#d9a86c', borderRadius: 4 }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
});

const analyticsDowCtx = document.getElementById('analyticsDowChart');
const analyticsDowChartInstance = new Chart(analyticsDowCtx, {
  type: 'bar',
  data: {
    labels: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    datasets: [{ label: 'Postings logged', data: [], backgroundColor: '#1a4d8f', borderRadius: 4 }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: { y: { beginAtZero: true } }
  }
});

const AVATAR_PALETTE = ['#4f7a52','#1a4d8f','#a3312e','#8a6d00','#6b4fa0','#0e7c86','#b5651d','#555555'];
function avatarColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}
function avatarInitial(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
function companyIconHTML(job, size) {
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${avatarColor(job.company)}">${escapeHTML(avatarInitial(job.company))}</span>`;
}
function switchView(view) {
  document.querySelectorAll('.view-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.getElementById('viewOverview').style.display = view === 'overview' ? '' : 'none';
  document.getElementById('viewBoard').style.display = view === 'board' ? '' : 'none';
  document.getElementById('viewList').style.display = view === 'list' ? '' : 'none';
  document.getElementById('viewFlow').style.display = view === 'flow' ? '' : 'none';
  if (view === 'board') renderBoard();
  if (view === 'list') renderList();
  if (view === 'flow') renderFlow();
}

const BOARD_COLUMNS = [
  { key: 'not_applied', label: 'Not Applied' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'screen', label: 'Screen (incl. OA / assessment)' },
  { key: 'interview', label: 'Interview' },
  { key: 'offer', label: 'Offer' },
  { key: 'action_required', label: 'Action Required' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'unclear', label: 'Unclear' },
  { key: 'duplicate', label: 'Duplicate' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'closed', label: 'Closed' },
  { key: 'withdrawn', label: 'Withdrawn' }
];
let boardSearchTerm = '';
let dragKey = null;
function boardCardHTML(j) {
  const key = jobKey(j);
  return `<div class="board-card" draggable="true" data-jobkey="${escapeHTML(key)}" data-open-detail="${escapeHTML(key)}">
    <div class="bc-top">
      ${companyIconHTML(j, 26)}
      <div>
        <div class="bc-company">${escapeHTML(j.company)}</div>
        <div class="bc-role">${escapeHTML(j.role)}</div>
        <div class="bc-loc">${escapeHTML(j.location || '')}</div>
      </div>
    </div>
  </div>`;
}
function handleCardDragStart(e) {
  const card = e.target.closest('.board-card');
  if (!card) return;
  dragKey = card.dataset.jobkey;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragKey);
}
function handleColDragOver(e) {
  e.preventDefault();
  e.currentTarget.style.background = '#e9e5da';
}
function handleColDragLeave(e) {
  e.currentTarget.style.background = '';
}
function handleColDrop(e) {
  e.preventDefault();
  e.currentTarget.style.background = '';
  const key = dragKey || e.dataTransfer.getData('text/plain');
  const newStatus = e.currentTarget.dataset.colkey;
  if (key && newStatus) setStatus(key, newStatus);
  dragKey = null;
}
function renderBoard() {
  let visible = JOBS.filter(j => !isBoardHiddenJob(j));
  const term = boardSearchTerm.toLowerCase();
  if (term) visible = visible.filter(j => (j.company + ' ' + j.role).toLowerCase().includes(term));
  const wrap = document.getElementById('boardWrap');
  wrap.innerHTML = BOARD_COLUMNS.map(col => {
    const items = visible.filter(j => boardColumnKey(j) === col.key);
    return `<div class="board-col" data-colkey="${col.key}">
      <h3><span>${col.label}</span><span>${items.length}</span></h3>
      ${items.map(boardCardHTML).join('') || '<div class="board-empty">Empty -- drop a card here</div>'}
    </div>`;
  }).join('');
  wrap.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('dragstart', handleCardDragStart);
    card.addEventListener('click', () => openDetail(card.dataset.openDetail));
  });
  wrap.querySelectorAll('.board-col').forEach(col => {
    col.addEventListener('dragover', handleColDragOver);
    col.addEventListener('dragleave', handleColDragLeave);
    col.addEventListener('drop', handleColDrop);
  });
}

let listSearchTerm = '';

function formatShortDate(iso) {
  if (!iso) return '';
  const d = parseJobDate({ date: iso });
  if (!d) return iso;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function locationDisplay(location) {
  const raw = (location || '').trim();
  if (!raw) return { primary: 'Location not listed', extra: 0 };
  let parts = raw.split(/\s*(?:;|\s\/\s|\s\+\s|\band\b)\s*/i).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1 && raw.includes(',')) {
    const commaParts = raw.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
    if (commaParts.length >= 3) parts = commaParts;
  }
  if (parts.length <= 1) return { primary: raw, extra: 0 };
  return { primary: parts[0], extra: parts.length - 1 };
}

function simplifyStageIndex(status) {
  if (!status || status === 'not_applied') return 0; // Saved only
  if (status === 'offer') return 4;
  if (status === 'interview') return 3;
  if (['screen', 'assessment', 'action_required'].includes(status)) return 2;
  return 1;
}

function listMetaIcons() {
  return {
    building: '<svg class="list-meta-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 14V3.5A1.5 1.5 0 0 1 4.5 2h5A1.5 1.5 0 0 1 11 3.5V6h1.5A1.5 1.5 0 0 1 14 7.5V14h-2v-2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5V14H3zm2-8h2V4H5v2zm0 3h2V7H5v2zm0 3h2v-2H5v2zm4-3h2V7H9v2z"/></svg>',
    pin: '<svg class="list-meta-icon" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2 4.5 8.5 4.5 8.5s4.5-5.3 4.5-8.5A4.5 4.5 0 0 0 8 1.5zm0 6.2A1.7 1.7 0 1 1 8 4.3a1.7 1.7 0 0 1 0 3.4z"/></svg>'
  };
}

function stepperHTML(j) {
  const status = effectiveStatus(j);
  const rejected = status === 'rejected';
  const stage = simplifyStageIndex(status);
  const dates = effectiveStageDates(j);
  const savedDate = formatShortDate(j.date);
  const steps = [
    { label: 'Saved', filled: true, date: savedDate },
    { label: 'Applied', filled: stage >= 1 || rejected, date: formatShortDate(dates.applied || '') },
    { label: 'Screen', filled: stage >= 2 || rejected, date: formatShortDate(dates.screen || dates.assessment || '') },
    { label: 'Interview', filled: stage >= 3 || rejected, date: formatShortDate(dates.interview || '') },
    { label: 'Offer', filled: stage >= 4 || rejected, date: formatShortDate(dates.offer || '') }
  ];
  if (rejected) {
    steps.push({
      label: 'Rejected',
      filled: true,
      date: formatShortDate(dates.rejected || todayISODate())
    });
  }
  let html = `<div class="stepper${rejected ? ' is-rejected' : ''}" aria-label="Application progress">`;
  steps.forEach((step, i) => {
    html += `<div class="step">
      <div class="dot${step.filled ? ' filled' : ''}"></div>
      <div class="steplabel${step.filled && !rejected ? ' active' : ''}">${step.label}</div>
      <div class="stepdate">${step.date ? escapeHTML(step.date) : ''}</div>
    </div>`;
    if (i < steps.length - 1) {
      const activeLine = rejected ? true : (i === 0 ? stage >= 1 : stage > i);
      html += `<div class="stepline${activeLine ? ' filled' : ''}"></div>`;
    }
  });
  html += '</div>';
  return html;
}

function listStatusSelectHTML(j) {
  const key = jobKey(j);
  const status = effectiveStatus(j);
  const options = STATUS_ORDER.map(s => {
    const label = s === 'not_applied' ? 'Not Applied' : (STATUS_LABELS[s] || s);
    return `<option value="${s}" ${s === status ? 'selected' : ''}>${label}</option>`;
  }).join('');
  return `<select class="list-status-select" data-jobkey="${escapeHTML(key)}" onclick="event.stopPropagation()" onchange="event.stopPropagation(); setStatusFromSelect(this)">${options}</select>`;
}

function listRowHTML(j) {
  const key = jobKey(j);
  const loc = locationDisplay(j.location);
  const locText = loc.extra > 0
    ? `${escapeHTML(loc.primary)} <span style="color:#aaa">+ ${loc.extra} more</span>`
    : escapeHTML(loc.primary);
  const icons = listMetaIcons();
  return `<div class="list-row" data-open-detail="${escapeHTML(key)}">
    <div class="list-left">
      ${companyIconHTML(j, 40)}
      <div class="list-info">
        <div class="li-role">${escapeHTML(j.role)}</div>
        <div class="li-company">${icons.building}<span>${escapeHTML(j.company)}</span></div>
        <div class="li-loc">${icons.pin}<span>${locText}</span></div>
      </div>
    </div>
    ${stepperHTML(j)}
    <div class="list-status">${listStatusSelectHTML(j)}</div>
  </div>`;
}
function renderList() {
  let visible = JOBS.filter(j => !isBoardHiddenJob(j));
  const term = listSearchTerm.toLowerCase();
  if (term) visible = visible.filter(j => (j.company + ' ' + j.role + ' ' + (j.location || '')).toLowerCase().includes(term));

  const listDate = (j) => {
    const dates = effectiveStageDates(j);
    return dates.applied || j.date || '';
  };
  visible.sort((a, b) => {
    const aApplied = effectiveApplied(a) ? 1 : 0;
    const bApplied = effectiveApplied(b) ? 1 : 0;
    if (bApplied !== aApplied) return bApplied - aApplied;
    return (listDate(b)).localeCompare(listDate(a)) || a.company.localeCompare(b.company);
  });

  document.getElementById('listRows').innerHTML = visible.map(listRowHTML).join('') || '<div class="empty">No matches.</div>';
  document.getElementById('listCount').textContent = visible.length + (visible.length === 1 ? ' job' : ' jobs');
  document.querySelectorAll('#listRows [data-open-detail]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('select')) return;
      openDetail(row.dataset.openDetail);
    });
  });
}

const SANKEY_NODES = [
  { key: 'submitted', label: 'Waiting', color: '#c4789a' },
  { key: 'screen', label: 'Screen', color: '#3c7f73' },
  { key: 'assessment', label: 'Assessment', color: '#b06b24' },
  { key: 'interview', label: 'Interview', color: '#7657a7' },
  { key: 'offer', label: 'Offer', color: '#2f7a3d' },
  { key: 'action_required', label: 'Action required', color: '#b5651d' },
  { key: 'in_progress', label: 'In progress', color: '#5b6eae' },
  { key: 'rejected', label: 'Rejected', color: '#a3312e' },
  { key: 'duplicate', label: 'Duplicate', color: '#9a958c' }
];

function isFlowJob(job) {
  const status = effectiveStatus(job);
  if (status === 'not_applied') return false;
  if (status === 'unclear' || status === 'closed' || status === 'withdrawn' || status === 'duplicate') return false;
  return true;
}

function parseJobDate(job) {
  if (!job || !job.date) return null;
  const d = new Date(job.date + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

function stageReach(job) {
  const status = effectiveStatus(job);
  const dates = effectiveStageDates(job);
  const reachedScreen = !!(dates.screen || dates.assessment || dates.interview || dates.offer) ||
    ['screen', 'assessment', 'action_required', 'interview', 'offer'].includes(status);
  const reachedInterview = !!(dates.interview || dates.offer) ||
    ['interview', 'offer'].includes(status);
  const reachedOffer = !!dates.offer || status === 'offer';
  return { status, reachedScreen, reachedInterview, reachedOffer };
}

function flowInsights(flowJobs) {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const applied = flowJobs.length;

  let screenAdv = 0, screenRej = 0, screenWait = 0;
  let interviewAdv = 0, interviewRej = 0, interviewWait = 0;
  let offerAdv = 0, offerRej = 0, offerWait = 0;
  let ghosted = 0;
  const interviewCompanies = [];
  const offerCompanies = [];
  const screenThenRejectCompanies = [];

  flowJobs.forEach(j => {
    const r = stageReach(j);
    if (r.status === 'submitted') ghosted += 1;
    if (r.reachedScreen) {
      screenAdv += 1;
      if (r.reachedInterview) {
        interviewAdv += 1;
        interviewCompanies.push(`${j.company} — ${j.role}`);
        if (r.reachedOffer) {
          if (r.status === 'offer') {
            offerAdv += 1;
            offerCompanies.push(`${j.company} — ${j.role}`);
          } else if (r.status === 'rejected' || r.status === 'withdrawn') {
            offerRej += 1;
          } else {
            offerWait += 1;
          }
        } else if (r.status === 'rejected') {
          offerRej += 1;
        } else {
          offerWait += 1;
        }
      } else if (r.status === 'rejected') {
        interviewRej += 1;
        screenThenRejectCompanies.push(`${j.company} — ${j.role}`);
      } else {
        interviewWait += 1;
      }
    } else if (r.status === 'rejected') {
      screenRej += 1;
    } else {
      screenWait += 1;
    }
  });

  interviewCompanies.sort((a, b) => a.localeCompare(b));
  offerCompanies.sort((a, b) => a.localeCompare(b));
  screenThenRejectCompanies.sort((a, b) => a.localeCompare(b));

  const ghostRate = applied ? Math.round((ghosted / applied) * 1000) / 10 : 0;

  const waitingJobs = flowJobs.filter(j => effectiveStatus(j) === 'submitted');
  let longestWait = 0;
  waitingJobs.forEach(j => {
    const d = parseJobDate(j);
    if (d) longestWait = Math.max(longestWait, daysBetween(d, today));
  });

  const responseDays = [];
  flowJobs.forEach(j => {
    const dates = effectiveStageDates(j);
    const applied = dates.applied;
    const firstResponse = dates.screen || dates.assessment || dates.interview || dates.offer;
    if (!applied || !firstResponse) return;
    const a = parseJobDate({ date: applied });
    const b = parseJobDate({ date: firstResponse });
    if (a && b && b.getTime() >= a.getTime()) responseDays.push(daysBetween(a, b));
  });
  const responseTimeLabel = responseDays.length
    ? `${Math.round((responseDays.reduce((s, n) => s + n, 0) / responseDays.length) * 10) / 10} days`
    : '—';

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayCounts = [0, 0, 0, 0, 0, 0, 0];
  const dates = [];
  flowJobs.forEach(j => {
    const d = parseJobDate(j);
    if (!d) return;
    dates.push(d);
    dayCounts[d.getDay()] += 1;
  });
  let mostActiveIdx = 0;
  dayCounts.forEach((n, i) => { if (n > dayCounts[mostActiveIdx]) mostActiveIdx = i; });
  const mostActiveDay = dates.length ? dayNames[mostActiveIdx] : '—';
  const mostActiveCount = dates.length ? dayCounts[mostActiveIdx] : 0;

  let perDay = 0, perWeek = 0, perMonth = 0;
  if (dates.length) {
    const minT = Math.min(...dates.map(d => d.getTime()));
    const maxT = Math.max(...dates.map(d => d.getTime()));
    const spanDays = Math.max(1, daysBetween(new Date(minT), new Date(maxT)) + 1);
    perDay = Math.round((applied / spanDays) * 10) / 10;
    perWeek = Math.round((applied / spanDays) * 7 * 10) / 10;
    perMonth = Math.round((applied / spanDays) * 30 * 10) / 10;
  }

  const pct = (num, den) => den ? Math.round((num / den) * 1000) / 10 : 0;

  return {
    applied,
    ghostRate,
    responseTimeLabel,
    longestWait,
    mostActiveDay,
    mostActiveCount,
    perDay,
    perWeek,
    perMonth,
    screenAdv, screenRej, screenWait,
    interviewAdv, interviewRej, interviewWait,
    offerAdv, offerRej, offerWait,
    interviewCompanies,
    offerCompanies,
    screenThenRejectCompanies,
    appliedToScreen: pct(screenAdv, applied),
    screenToInterview: pct(interviewAdv, screenAdv),
    interviewToOffer: pct(offerAdv, interviewAdv)
  };
}

function renderFlow() {
  const flowJobs = JOBS.filter(j => !isHiddenJob(j) && isFlowJob(j));
  const insights = flowInsights(flowJobs);

  document.getElementById('insightCards').innerHTML = `
    <div class="insight-card">
      <div class="insight-metric highlight-amber">
        <span class="insight-metric-label">Ghost Rate</span>
        <span class="insight-metric-value">${insights.ghostRate}%</span>
      </div>
      <div class="insight-metric-plain">
        <span>Response Time</span>
        <span class="insight-metric-value">${insights.responseTimeLabel}</span>
      </div>
      <div class="insight-metric-plain">
        <span>Longest Waiting Application</span>
        <span class="insight-metric-value">${insights.longestWait} days</span>
      </div>
    </div>
    <div class="insight-card">
      <div class="insight-metric highlight-green">
        <span class="insight-metric-label">Total Applications</span>
        <span class="insight-metric-value">${insights.applied}</span>
      </div>
      <div class="insight-metric-plain">
        <span>Most Active Day</span>
        <span class="insight-metric-value">${escapeHTML(insights.mostActiveDay)}${insights.mostActiveCount ? `<span class="insight-day-badge">${insights.mostActiveCount} apps</span>` : ''}</span>
      </div>
      <div>
        <div class="insight-metric-plain" style="padding-bottom:0"><span>Application Rate</span></div>
        <div class="insight-rate-row">
          <span><strong>${insights.perDay}</strong> /day</span>
          <span><strong>${insights.perWeek}</strong> /wk</span>
          <span><strong>${insights.perMonth}</strong> /mo</span>
          <span><strong>${insights.applied}</strong> /yr</span>
        </div>
      </div>
    </div>
    <div class="insight-card">
      <div class="insight-metric highlight-rose">
        <span class="insight-metric-label">Applied → Screening</span>
        <span class="insight-metric-value">${insights.appliedToScreen}%</span>
      </div>
      <div class="insight-metric-plain">
        <span>Screening → Interview</span>
        <span class="insight-metric-value">${insights.screenToInterview}%</span>
      </div>
      <div class="insight-metric-plain">
        <span>Interview → Offer</span>
        <span class="insight-metric-value">${insights.interviewToOffer}%</span>
      </div>
    </div>`;

  const waitingTotal = insights.screenWait + insights.interviewWait + insights.offerWait;
  const rejectedTotal = insights.screenRej + insights.interviewRej + insights.offerRej;
  const END_COL = 3;
  const fmtList = (arr, empty) => arr && arr.length
    ? arr.join(' · ')
    : (empty || '—');
  const nodes = [
    { key: 'applied', label: 'Applied', color: '#3d6fd1', value: insights.applied, col: 0,
      detail: `${insights.applied} applications in the funnel` },
    { key: 'screen', label: 'Screen / OA', color: '#3c7f73', value: insights.screenAdv, col: 1,
      detail: `${insights.screenAdv} reached screen/OA` },
    { key: 'interview', label: 'Interview', color: '#7657a7', value: insights.interviewAdv, col: 2,
      detail: fmtList(insights.interviewCompanies, 'No interview-reach roles') },
    { key: 'waiting', label: 'Waiting', color: '#c4789a', value: waitingTotal, col: END_COL,
      detail: `${waitingTotal} still waiting (no next-stage advance yet)` },
    { key: 'offer', label: 'Offer', color: '#2f7a3d', value: insights.offerAdv, col: END_COL,
      detail: fmtList(insights.offerCompanies, 'No active offers') },
    { key: 'rejected', label: 'Rejected', color: '#a3312e', value: rejectedTotal, col: END_COL,
      detail: insights.screenThenRejectCompanies.length
        ? `Screen→reject: ${fmtList(insights.screenThenRejectCompanies.slice(0, 12))}`
        : `${rejectedTotal} rejected at some stage` }
  ].filter(n => n.value > 0);

  const edges = [
    { from: 'applied', to: 'screen', value: insights.screenAdv },
    { from: 'applied', to: 'waiting', value: insights.screenWait },
    { from: 'applied', to: 'rejected', value: insights.screenRej },
    { from: 'screen', to: 'interview', value: insights.interviewAdv },
    { from: 'screen', to: 'waiting', value: insights.interviewWait },
    { from: 'screen', to: 'rejected', value: insights.interviewRej },
    { from: 'interview', to: 'offer', value: insights.offerAdv },
    { from: 'interview', to: 'waiting', value: insights.offerWait },
    { from: 'interview', to: 'rejected', value: insights.offerRej }
  ].filter(e => e.value > 0);

  renderSankeyColumns(nodes, edges);
}

const SANKEY_LAYOUT_KEY = 'jsdb_sankey_layout_v6';
let lastSankeyArgs = null;
let sankeyDrag = null;
let sankeyLayout = loadSankeyLayout();

function loadSankeyLayout() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SANKEY_LAYOUT_KEY) || '{}');
    return { nodes: parsed.nodes && typeof parsed.nodes === 'object' ? parsed.nodes : {} };
  } catch (e) {
    return { nodes: {} };
  }
}

function saveSankeyLayout() {
  localStorage.setItem(SANKEY_LAYOUT_KEY, JSON.stringify(sankeyLayout));
}

function resetSankeyLayout() {
  sankeyLayout = { nodes: {} };
  localStorage.removeItem(SANKEY_LAYOUT_KEY);
  if (lastSankeyArgs) renderSankeyColumns(...lastSankeyArgs);
  else renderFlow();
}

function clampSankey(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sankeyGrip(x, y, height) {
  const center = y + height / 2;
  return [-5, 0, 5].map(offset =>
    `<circle class="sankey-grip" cx="${x}" cy="${center + offset}" r="1.2" fill="#fff"></circle>`
  ).join('');
}

function svgPoint(svgEl, evt) {
  const rect = svgEl.getBoundingClientRect();
  const vb = svgEl.viewBox.baseVal;
  return {
    x: (evt.clientX - rect.left) * vb.width / rect.width,
    y: (evt.clientY - rect.top) * vb.height / rect.height
  };
}

function renderSankeyColumns(nodes, edges) {
  lastSankeyArgs = [nodes, edges];
  const svgEl = document.getElementById('sankeySvg');
  const tooltip = document.getElementById('sankeyTooltip');

  if (!nodes.length) {
    svgEl.setAttribute('viewBox', '0 0 1400 140');
    svgEl.innerHTML = '<text x="28" y="68" font-size="14" fill="#999">Not enough data yet to draw a flow.</text>';
    return;
  }

  const byKey = {};
  nodes.forEach(n => { byKey[n.key] = { ...n }; });
  const maxCol = Math.max(...nodes.map(n => n.col));
  const W = 1520;
  const H = 760;
  const topY = 56;
  const bottomY = H - 40;
  const availableH = bottomY - topY;
  const barW = 16;
  const leftX = 86;
  const rightX = W - 200;
  const colGap = maxCol > 0 ? (rightX - leftX) / maxCol : 0;

  const outOrder = { waiting: 0, screen: 1, interview: 1, offer: 1, rejected: 2 };
  const inOrder = { applied: 0, screen: 1, interview: 2 };
  const progressKeys = ['screen', 'interview'].filter(k => byKey[k]);
  const endKeys = ['waiting', 'offer', 'rejected'].filter(k => byKey[k]);
  const END_PAD_TOTAL = Math.round(availableH * 0.32);
  const NODE_GAP = 48; // gap between Screen / Interview

  function edgeValue(from, to) {
    const e = edges.find(x => x.from === from && x.to === to);
    return e ? e.value : 0;
  }

  const endUnits = endKeys.reduce((s, k) => s + byKey[k].value, 0);
  const endGapCount = Math.max(endKeys.length - 1, 0);
  const endPad = endGapCount ? END_PAD_TOTAL : 0;
  let px = endUnits > 0 ? (availableH - endPad) / endUnits : (availableH / Math.max(byKey.applied?.value || 1, 1));
  if (!Number.isFinite(px) || px <= 0) px = availableH / Math.max(byKey.applied?.value || 1, 1);

  function hOf(value) {
    return Math.max(value * px, value > 0 ? 3 : 0);
  }

  const defaultYs = {};
  const endGap = endGapCount ? END_PAD_TOTAL / endGapCount : 0;
  const appliedH = byKey.applied ? hOf(byKey.applied.value) : 0;

  let endCursor = topY;
  endKeys.forEach((k, i) => {
    defaultYs[k] = endCursor;
    endCursor += hOf(byKey[k].value) + (i < endKeys.length - 1 ? endGap : 0);
  });

  const fanTop = endKeys.length ? defaultYs[endKeys[0]] : topY;
  const lastEnd = endKeys.length ? endKeys[endKeys.length - 1] : null;
  const fanBottom = lastEnd ? defaultYs[lastEnd] + hOf(byKey[lastEnd].value) : bottomY;
  const fanSpan = Math.max(fanBottom - fanTop, appliedH);

  if (byKey.applied) {
    defaultYs.applied = fanTop + (fanSpan - appliedH) / 2;
  }

  if (progressKeys.length) {
    const progHeights = progressKeys.map(k => hOf(byKey[k].value));
    const progBlock = progHeights.reduce((s, h) => s + h, 0) + NODE_GAP * Math.max(progressKeys.length - 1, 0);
    let startY = fanTop + (fanSpan - progBlock) / 2;
    if (byKey.applied) {
      const appliedMid = defaultYs.applied + appliedH * 0.55;
      startY = Math.max(fanTop + 8, Math.min(appliedMid, fanBottom - progBlock - 8));
    }
    startY = clampSankey(startY, topY, bottomY - progBlock);
    let cursor = startY;
    progressKeys.forEach((k, i) => {
      defaultYs[k] = cursor;
      cursor += progHeights[i] + NODE_GAP;
    });
  }

  nodes.forEach(n => {
    if (defaultYs[n.key] == null) defaultYs[n.key] = topY;
  });

  const laidOut = nodes.map(node => {
    const height = hOf(node.value);
    const stored = sankeyLayout.nodes[node.key];
    const y = clampSankey(
      Number.isFinite(stored) ? stored : defaultYs[node.key],
      topY,
      bottomY - height
    );
    return {
      ...node,
      x: leftX + node.col * colGap,
      y,
      height
    };
  });
  const laidByKey = {};
  laidOut.forEach(n => { laidByKey[n.key] = n; });

  function sortedOut(fromKey) {
    return edges
      .filter(e => e.from === fromKey && laidByKey[e.to])
      .slice()
      .sort((a, b) => (outOrder[a.to] ?? 9) - (outOrder[b.to] ?? 9) || a.to.localeCompare(b.to));
  }
  function sortedIn(toKey) {
    return edges
      .filter(e => e.to === toKey && laidByKey[e.from])
      .slice()
      .sort((a, b) => (inOrder[a.from] ?? 9) - (inOrder[b.from] ?? 9));
  }

  function allocateSlices(node, edgeList, useOutgoing) {
    const total = edgeList.reduce((s, e) => s + e.value, 0) || 1;
    let cursor = node.y;
    const slots = {};
    edgeList.forEach(e => {
      const h = Math.max((e.value / total) * node.height, 1.5);
      slots[useOutgoing ? e.to : e.from] = { y0: cursor, y1: cursor + h, value: e.value };
      cursor += h;
    });
    return slots;
  }

  function draw() {
    const outSlots = {};
    const inSlots = {};
    laidOut.forEach(node => {
      outSlots[node.key] = allocateSlices(node, sortedOut(node.key), true);
      inSlots[node.key] = allocateSlices(node, sortedIn(node.key), false);
    });

    let defsSvg = '';
    let bandsSvg = '';
    edges.forEach(edge => {
      const src = laidByKey[edge.from];
      const dst = laidByKey[edge.to];
      if (!src || !dst) return;
      const s = outSlots[edge.from][edge.to];
      const t = inSlots[edge.to][edge.from];
      if (!s || !t) return;
      const gradId = 'grad-' + edge.from + '-' + edge.to;
      const midX = src.x + barW + (dst.x - src.x - barW) * 0.55;
      defsSvg += `<linearGradient id="${gradId}" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="${src.color}" stop-opacity=".38"></stop>
        <stop offset="100%" stop-color="${dst.color}" stop-opacity=".38"></stop>
      </linearGradient>`;
      const path = `M ${src.x + barW} ${s.y0}
        C ${midX} ${s.y0}, ${midX} ${t.y0}, ${dst.x} ${t.y0}
        L ${dst.x} ${t.y1}
        C ${midX} ${t.y1}, ${midX} ${s.y1}, ${src.x + barW} ${s.y1} Z`;
      bandsSvg += `<path class="sankey-band" d="${path}" fill="url(#${gradId})"
        data-label="${escapeHTML(src.label)} &#8594; ${escapeHTML(dst.label)}" data-value="${edge.value}"></path>`;
    });

    let nodesSvg = '';
    laidOut.forEach(node => {
      const labelY = node.y + Math.min(20, node.height / 2 + 5);
      let labelAttrs;
      if (node.col === 0) {
        labelAttrs = `x="${node.x - 12}" y="${labelY}" text-anchor="end"`;
      } else if (node.key === 'waiting' || node.key === 'offer' || node.key === 'rejected') {
        labelAttrs = `x="${node.x + barW + 14}" y="${labelY}" text-anchor="start"`;
      } else {
        labelAttrs = `x="${node.x + barW + 12}" y="${labelY}" text-anchor="start"`;
      }
      nodesSvg += `<g class="sankey-handle${sankeyDrag && sankeyDrag.key === node.key ? ' dragging' : ''}"
          data-drag-key="${node.key}" data-label="${escapeHTML(node.label)}" data-detail="${escapeHTML(node.detail || String(node.value))}" aria-label="Drag ${escapeHTML(node.label)}">
        <rect class="handle-outline" x="${node.x - 5}" y="${node.y - 5}" width="${barW + 10}" height="${node.height + 10}" rx="5"></rect>
        <rect x="${node.x}" y="${node.y}" width="${barW}" height="${node.height}" rx="3" fill="${node.color}"></rect>
        ${sankeyGrip(node.x + barW / 2, node.y, node.height)}
        <text class="sankey-node-label" ${labelAttrs} font-size="13" font-weight="700" fill="#1e1e1e">${escapeHTML(node.label).toUpperCase()} <tspan fill="#777" font-weight="600">(${node.value})</tspan></text>
      </g>`;
    });

    svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svgEl.innerHTML = `<defs>${defsSvg}</defs>${bandsSvg}${nodesSvg}`;
  }

  draw();

  svgEl.onpointerdown = event => {
    const handle = event.target.closest('[data-drag-key]');
    if (!handle) return;
    event.preventDefault();
    const key = handle.dataset.dragKey;
    const node = laidByKey[key];
    if (!node) return;
    sankeyDrag = { key, pointerId: event.pointerId, offsetY: svgPoint(svgEl, event).y - node.y };
    svgEl.setPointerCapture(event.pointerId);
    tooltip.style.display = 'none';
    draw();
  };

  svgEl.onpointermove = event => {
    if (sankeyDrag) {
      const node = laidByKey[sankeyDrag.key];
      if (!node) return;
      const y = svgPoint(svgEl, event).y - sankeyDrag.offsetY;
      node.y = clampSankey(y, topY, bottomY - node.height);
      sankeyLayout.nodes[node.key] = node.y;
      draw();
      return;
    }
    const handle = event.target.closest('.sankey-handle');
    const band = event.target.closest('.sankey-band');
    const tipTarget = handle || band;
    if (!tipTarget) {
      tooltip.style.display = 'none';
      return;
    }
    const rect = svgEl.parentElement.getBoundingClientRect();
    tooltip.style.display = 'block';
    tooltip.style.left = (event.clientX - rect.left + 14) + 'px';
    tooltip.style.top = (event.clientY - rect.top - 10) + 'px';
    if (handle) {
      tooltip.innerHTML = `<div class="tt-title">${handle.dataset.label} (${laidByKey[handle.dataset.dragKey]?.value || ''})</div>${escapeHTML(handle.dataset.detail || '')}`;
    } else {
      tooltip.innerHTML = `<div class="tt-title">${band.dataset.label}</div>${band.dataset.value}`;
    }
  };

  function endSankeyDrag(event) {
    if (!sankeyDrag) return;
    if (event && event.pointerId !== sankeyDrag.pointerId) return;
    if (svgEl.hasPointerCapture(sankeyDrag.pointerId)) svgEl.releasePointerCapture(sankeyDrag.pointerId);
    sankeyDrag = null;
    saveSankeyLayout();
    draw();
  }

  svgEl.onpointerup = endSankeyDrag;
  svgEl.onpointercancel = endSankeyDrag;
  svgEl.onpointerleave = () => {
    if (!sankeyDrag) tooltip.style.display = 'none';
  };
}

function copyPitch(btn) {
  const box = btn.previousElementSibling;
  const finish = (ok) => {
    btn.textContent = ok ? 'Copied!' : 'Copy failed — select manually';
    btn.classList.toggle('copied', ok);
    setTimeout(() => { btn.textContent = 'Copy pitch'; btn.classList.remove('copied'); }, 1800);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(box.value).then(() => finish(true)).catch(() => {
      box.select();
      try { finish(document.execCommand('copy')); } catch (e) { finish(false); }
    });
  } else {
    box.select();
    try { finish(document.execCommand('copy')); } catch (e) { finish(false); }
  }
}
function jobDetailHTML(job) {
  const key = jobKey(job);
  const status = effectiveStatus(job);

  const noteHTML = job.note ? `<div class="note" style="display:block;">${escapeHTML(job.note)}</div>` : '';
  const actionHTML = job.action ? `<div class="action-banner">&#9888; Outstanding task: ${escapeHTML(job.action)}</div>` : '';
  const actionBtnHTML = job.actionLink ? `<a class="applylink action-link" href="${safeLink(job.actionLink)}" target="_blank" rel="noopener">Complete task &#8594;</a>` : '';
  const linkHTML = job.link ? `<a class="applylink" href="${safeLink(job.link)}" target="_blank" rel="noopener">Open posting &#8594;</a>` : '';
  const folderBtnHTML = (window.desktop && job.resumePath)
    ? `<div class="card-actions" style="margin-top:8px;">
        <button class="mini-btn" data-jobkey="${escapeHTML(key)}" onclick="openJobFolderFromEl(this)" title="Reveal resume">&#128193; Reveal resume</button>
        <button class="mini-btn" draggable="true" data-jobkey="${escapeHTML(key)}" ondragstart="startResumeDragFromEl(this, event)" title="Drag resume file into another app">&#128196; Drag resume</button>
      </div>`
    : '';
  const pitchHTML = (job.source === 'yc' && job.waasPitch && !job.applied) ? `
    <div class="detail-section-label">Outreach pitch &middot; drafted, copy into the WAAS reach-out form</div>
    <textarea class="pitch-box" readonly onclick="this.select();">${escapeHTML(job.waasPitch)}</textarea>
    <button class="copy-btn" onclick="copyPitch(this)">Copy pitch</button>
  ` : '';
  const payText = job.pay || 'Pay not listed';
  const isEstimate = payText.startsWith('Est.');
  const payBadge = `<span class="pay-badge${isEstimate ? ' est' : ''}">${escapeHTML(payText)}</span>`;
  const urgentPill = effectiveUrgent(job) ? '<span class="urgent-pill">URGENT</span>' + urgentPriorityPill(job) : '';
  const options = STATUS_ORDER.map(s => {
    const label = s === 'not_applied' ? 'Not Applied' : (STATUS_LABELS[s] || s);
    return `<option value="${s}" ${s === status ? 'selected' : ''}>${label}</option>`;
  }).join('');
  const flowLabel = status === 'not_applied' ? 'Not applied' : (STATUS_LABELS[status] || status);
  return `
    <button class="detail-close" onclick="closeDetail()">&#10005;</button>
    <div class="detail-top">
      ${companyIconHTML(job, 42)}
      <div>
        <div class="detail-company">${escapeHTML(job.company)}</div>
        <div class="detail-role">${escapeHTML(job.role)}</div>
        <div class="detail-loc">${escapeHTML(job.location || '')}</div>
      </div>
    </div>
    <div class="detail-status-row">
      ${urgentPill}${payBadge}
      <select class="status-select" data-jobkey="${escapeHTML(key)}" onchange="setStatusFromSelect(this)">${options}</select>
    </div>
    <div class="detail-section-label">Application status</div>
    <div style="font-size:13px;color:#444;">${escapeHTML(flowLabel)}</div>

    <div class="detail-section-label">Term / source</div>
    <div style="font-size:13px;color:#444;">${escapeHTML(job.term || '')} &middot; ${escapeHTML(sourceLabel(job))} &middot; found ${escapeHTML(job.date)}</div>
    ${actionHTML}
    ${pitchHTML}
    ${noteHTML ? `<div class="detail-section-label">Note</div>${noteHTML}` : ''}
    ${actionBtnHTML}
    ${linkHTML}
    ${folderBtnHTML}
    <div class="card-actions" style="margin-top:14px;">
      <button class="mini-btn" onclick="editJob(this.dataset.id)" data-id="${escapeHTML(key)}">Edit details</button>
      <button class="mini-btn danger" data-jobkey="${escapeHTML(key)}" onclick="hideJobFromEl(this)">Mark withdrawn</button>
    </div>
  `;
}
function openDetail(key) {
  const job = JOBS.find(j => jobKey(j) === key);
  if (!job) return;
  const modal = document.getElementById('detailModal');
  modal.dataset.jobkey = key;
  modal.innerHTML = jobDetailHTML(job);
  document.getElementById('detailBackdrop').classList.add('open');
}
function closeDetail() {
  document.getElementById('detailBackdrop').classList.remove('open');
}
function closeDetailBackdrop(e) {
  if (e.target.id === 'detailBackdrop') closeDetail();
}

loadWorkspace();
