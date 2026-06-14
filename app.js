// ============================================================
// Planner — app logic (vanilla ES module)
// Top app bar shell · calendar · notes · to-do with subtasks · tweaks
// ============================================================

import {
    watchAuth, currentUser, signInGoogle, signOut as cloudSignOut,
    sendEmailLink, completeEmailLinkIfPresent,
    loadCloudState, saveCloudState, watchCloudState,
} from './firebase.js';

const STORAGE_KEY = 'cefalo.planner.v3';
const TWEAKS_KEY = 'cefalo.planner.tweaks.v1';
const NOTES_KEY = 'cefalo.planner.notes.v1';
const GOALS_KEY = 'cefalo.planner.goals.v1';

const DEFAULT_TWEAKS = {
    accent: 'cyan',
    dark: false,
    head: 'aesthetic',
    density: 'regular',
    radius: 'soft',
    notesCollapsed: false,
};

// ============== STATE ==============
const state = {
    tab: 'today',                // today | goals
    filter: 'all',               // all | open | done
    tasks: [],
    notes: '',
    goals: [],                   // [{id, monthOffset, text, done, created}] monthOffset: 0=current,1,2
    selectedDate: todayISO(),    // ISO date string the calendar/today view points at
    calMonth: new Date(),        // any Date in the visible month
    expanded: new Set(),
    addingSubFor: null,
    tweaks: { ...DEFAULT_TWEAKS },
};

// ============== UTIL ==============
const uid = () => Math.random().toString(36).slice(2, 10);
function todayISO() { return isoDate(new Date()); }
function isoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function parseISO(s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function addMonths(d, n) { const r = new Date(d); r.setMonth(r.getMonth() + n); return r; }
function sameDay(a, b) {
    return a && b && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function fmtLongDate(d) {
    return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function fmtMonthYear(d) {
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
function fmtDuration(min) {
    if (min == null) return '';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
}
function greetingFor(d) {
    const h = d.getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
}
function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
}

// ============== PERSISTENCE ==============
function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks })); }
    catch (e) { console.warn('Save failed', e); }
    scheduleCloudSync();
}
function load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (Array.isArray(data?.tasks)) {
            data.tasks.forEach(t => { if (!Array.isArray(t.subtasks)) t.subtasks = []; });
            return data;
        }
    } catch (e) { }
    return null;
}
function saveTweaks() {
    try { localStorage.setItem(TWEAKS_KEY, JSON.stringify(state.tweaks)); } catch (e) { }
    scheduleCloudSync();
}
function loadTweaks() {
    try {
        const raw = localStorage.getItem(TWEAKS_KEY);
        if (!raw) return null;
        return { ...DEFAULT_TWEAKS, ...JSON.parse(raw) };
    } catch (e) { return null; }
}
function saveNotes() {
    try { localStorage.setItem(NOTES_KEY, state.notes); } catch (e) { }
    scheduleCloudSync();
}
function loadNotes() {
    try { return localStorage.getItem(NOTES_KEY) || ''; }
    catch (e) { return ''; }
}
function saveGoals() {
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(state.goals)); } catch (e) { }
    scheduleCloudSync();
}
function loadGoals() {
    try {
        const raw = localStorage.getItem(GOALS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

// ============== CLOUD SYNC ==============
let _cloudSyncTimer = null;
let _suppressCloudSync = false; // true while we're applying cloud → local
function scheduleCloudSync() {
    if (_suppressCloudSync) return;
    const user = currentUser();
    if (!user) return;
    clearTimeout(_cloudSyncTimer);
    _cloudSyncTimer = setTimeout(() => {
        saveCloudState(user.uid, {
            tasks: state.tasks,
            notes: state.notes,
            tweaks: state.tweaks,
            goals: state.goals,
        });
    }, 400);
}

function applyCloudState(data) {
    if (!data) return;
    _suppressCloudSync = true;
    try {
        if (Array.isArray(data.tasks)) {
            state.tasks = data.tasks.map(t => ({ ...t, subtasks: Array.isArray(t.subtasks) ? t.subtasks : [] }));
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ tasks: state.tasks })); } catch (e) { }
        }
        if (typeof data.notes === 'string') {
            state.notes = data.notes;
            try { localStorage.setItem(NOTES_KEY, state.notes); } catch (e) { }
        }
        if (data.tweaks && typeof data.tweaks === 'object') {
            state.tweaks = { ...DEFAULT_TWEAKS, ...data.tweaks };
            try { localStorage.setItem(TWEAKS_KEY, JSON.stringify(state.tweaks)); } catch (e) { }
        }
        if (Array.isArray(data.goals)) {
            state.goals = data.goals;
            try { localStorage.setItem(GOALS_KEY, JSON.stringify(state.goals)); } catch (e) { }
        }
        applyTweaks();
        renderAll();
    } finally {
        _suppressCloudSync = false;
    }
}

let _cloudUnsub = null;
async function onAuthChange(user) {
    if (_cloudUnsub) { _cloudUnsub(); _cloudUnsub = null; }
    updateAuthUI(user);
    if (!user) {
        showAuthGate();
        return;
    }
    hideAuthGate();
    // First sign-in on this device: try cloud → if empty, push local
    const cloud = await loadCloudState(user.uid);
    if (cloud && (Array.isArray(cloud.tasks) || typeof cloud.notes === 'string')) {
        applyCloudState(cloud);
    } else {
        // Push current local state up to seed the cloud doc
        saveCloudState(user.uid, {
            tasks: state.tasks,
            notes: state.notes,
            tweaks: state.tweaks,
            goals: state.goals,
        });
    }
    // Subscribe to live changes (other devices/tabs)
    _cloudUnsub = watchCloudState(user.uid, (data) => {
        applyCloudState(data);
    });
}

function showAuthGate() {
    const gate = $('#authGate');
    const app = $('#app');
    if (gate) gate.removeAttribute('aria-hidden');
    if (app) app.hidden = true;
    renderGateButtons();
    refreshIcons();
}

function hideAuthGate() {
    const gate = $('#authGate');
    const app = $('#app');
    if (gate) gate.setAttribute('aria-hidden', 'true');
    if (app) app.hidden = false;
}

function renderGateButtons() {
    const container = $('#authGateActions');
    if (!container) return;
    container.innerHTML = `
        <button class="btn btn-primary auth-google" id="gateGoogleBtn">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.4 4 9.8 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.2 35 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.4-2.4 4.4-4.5 5.6l6.2 5.2C40.6 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            <span>Continue with Google</span>
        </button>
        <div class="auth-divider"><span>or</span></div>
        <form id="gateEmailForm" class="auth-email">
            <input type="email" id="gateEmailInput" placeholder="you@example.com" required autocomplete="email" />
            <button class="btn btn-secondary" type="submit">
                <i data-lucide="mail"></i><span>Email me a sign-in link</span>
            </button>
        </form>
    `;
    refreshIcons();
    $('#gateGoogleBtn').addEventListener('click', async () => {
        try {
            await signInGoogle();
        } catch (e) {
            console.error(e);
            toast(e?.code === 'auth/popup-closed-by-user' ? 'Cancelled' : 'Sign-in failed');
        }
    });
    $('#gateEmailForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('#gateEmailInput').value.trim();
        if (!email) return;
        try {
            await sendEmailLink(email);
            container.innerHTML = `<p style="text-align:center;color:var(--fg-muted);font-size:14px;padding:8px 0;">Check <strong>${escapeHtml(email)}</strong> for a sign-in link.</p>`;
        } catch (err) {
            console.error(err);
            toast('Could not send link — check Firebase auth settings');
        }
    });
}

function updateAuthUI(user) {
    const avatar = $('#avatarBtn');
    if (!avatar) return;
    if (user) {
        const initial = (user.displayName || user.email || '?').trim().charAt(0).toUpperCase();
        avatar.textContent = initial;
        avatar.title = user.displayName || user.email || 'Signed in';
        avatar.classList.add('is-signed-in');
    } else {
        avatar.textContent = 'S';
        avatar.title = 'Sign in';
        avatar.classList.remove('is-signed-in');
    }
}

function seedDemo() {
    const tod = todayISO();
    const sub = (title, done = false) => ({ id: uid(), title, done });
    return {
        tasks: [
            {
                id: uid(), title: 'Reply to client thread', done: true,
                date: tod, duration: 15, category: 'Work',
                subtasks: [], created: Date.now() - 9e6,
            },
            {
                id: uid(), title: 'Review two pull requests', done: false,
                date: tod, duration: 45, category: 'Work',
                subtasks: [sub('auth service refactor', true), sub('payments hotfix')],
                created: Date.now() - 8e6,
            },
            {
                id: uid(), title: 'Book flights for the Dhaka visit', done: false,
                date: tod, duration: 30, category: 'Travel',
                subtasks: [
                    sub('Compare Oslo → Dhaka routes'),
                    sub('Confirm dates with team'),
                    sub('Add to expense report'),
                ],
                created: Date.now() - 7e6,
            },
            {
                id: uid(), title: 'Pick up groceries', done: false,
                date: tod, duration: 30, category: 'Home',
                subtasks: [], created: Date.now() - 6e6,
            },
            {
                id: uid(), title: 'Read 20 pages', done: false,
                date: tod, duration: 25, category: 'Personal',
                subtasks: [], created: Date.now() - 5e6,
            },
        ],
    };
}

function init() {
    const loaded = load() || seedDemo();
    state.tasks = loaded.tasks;
    state.tweaks = loadTweaks() || { ...DEFAULT_TWEAKS };
    state.notes = loadNotes();
    state.goals = loadGoals();
}

// ============== SELECTORS ==============
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function tasksForSelectedDate() {
    return state.tasks.filter(t => t.date === state.selectedDate);
}

function filteredTasks() {
    let list = tasksForSelectedDate();
    if (state.filter === 'open') list = list.filter(t => !t.done);
    if (state.filter === 'done') list = list.filter(t => t.done);
    // Preserve creation order so the list reads like a natural log.
    list.sort((a, b) => a.created - b.created);
    return list;
}

// ============== RENDER ==============
function renderAll() {
    renderHead();
    renderCalendar();
    renderNotes();
    renderTodo();
    renderGoals();
    refreshIcons();
}

function renderHead() {
    const sel = parseISO(state.selectedDate) || new Date();
    const isToday = sameDay(sel, new Date());
    const dateLabel = isToday ? 'Today, ' + fmtLongDate(sel) : fmtLongDate(sel);
    $('#pageDate').textContent = dateLabel;

    // Day progress
    const todays = tasksForSelectedDate();
    const total = todays.length;
    const done = todays.filter(t => t.done).length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    $('#dpPct').textContent = `${pct}%`;
    $('#dpFrac').textContent = `${done}/${total}`;
    $('#dpFill').setAttribute('stroke-dasharray', `${pct} ${100 - pct}`);
}

function renderCalendar() {
    $('#calLabel').textContent = fmtMonthYear(state.calMonth);

    const first = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth(), 1);
    const last = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 0);
    // Sunday-start (matches the screenshot: S M T W T F S — but screenshot uses S M T W T S S
    // which has 7 cols. Standard Sunday-start gives S M T W T F S — we'll match that.)
    const startPad = first.getDay(); // 0 = Sun
    const daysInMonth = last.getDate();
    const cells = [];

    for (let i = 0; i < startPad; i++) cells.push({ empty: true });
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth(), d);
        const iso = isoDate(date);
        const isToday = sameDay(date, new Date());
        const isSelected = iso === state.selectedDate;
        const hasTasks = state.tasks.some(t => t.date === iso);
        cells.push({ d, iso, isToday, isSelected, hasTasks });
    }
    while (cells.length % 7) cells.push({ empty: true });

    $('#calGrid').innerHTML = cells.map(c => {
        if (c.empty) return `<span class="cal-cell is-empty"></span>`;
        const cls = ['cal-cell'];
        if (c.isToday) cls.push('is-today');
        if (c.isSelected && !c.isToday) cls.push('is-selected');
        if (c.hasTasks) cls.push('has-tasks');
        return `<button class="${cls.join(' ')}" data-date="${c.iso}">${c.d}</button>`;
    }).join('');
}

function renderNotes() {
    const area = $('#notesArea');
    if (area && area.value !== state.notes) area.value = state.notes;
}

function renderTodo() {
    const list = filteredTasks();
    const allToday = tasksForSelectedDate();
    const openTasks = allToday.filter(t => !t.done);
    const totalMin = openTasks.reduce((acc, t) => acc + (t.duration || 0), 0);
    const done = allToday.filter(t => t.done).length;

    $('#todoSub').textContent = totalMin > 0
        ? `${fmtDuration(totalMin)} of work left to do`
        : (allToday.length === 0 ? 'No tasks for this day' : 'All done — take the win.');
    $('#todoCount').textContent = `${done}/${allToday.length}`;

    const ul = $('#taskList');
    if (list.length === 0) {
        ul.innerHTML = `<li class="empty-row">
            ${state.filter === 'all' ? 'Nothing here yet — add your first task below.' :
                state.filter === 'open' ? 'No open tasks. Nice.' : 'Nothing completed yet.'}
        </li>`;
        return;
    }
    ul.innerHTML = list.map(t => taskTemplate(t)).join('');
}

// ============== GOALS ==============
function goalMonthInfo(offset) {
    const now = new Date();
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const monthName = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    // Range: 1st → last day of that month
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const fmt = (dt) => dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { monthName, range: `${fmt(d)} – ${fmt(last)}` };
}

function renderGoals() {
    const grid = $('#goalsGrid');
    if (!grid) return;

    // Plan title: first month – third month range
    const start = new Date(); start.setDate(1);
    const endMonth = new Date(start.getFullYear(), start.getMonth() + 3, 0);
    const fmtM = (d) => d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const titleEl = $('#goalsPlanTitle');
    const rangeEl = $('#goalsPlanRange');
    if (titleEl) titleEl.textContent = '3-Month Plan';
    if (rangeEl) rangeEl.textContent = `${fmtM(start)} – ${fmtM(endMonth)}`;

    grid.innerHTML = [0, 1, 2].map(offset => {
        const { monthName, range } = goalMonthInfo(offset);
        const items = state.goals.filter(g => g.monthOffset === offset);
        const doneCount = items.filter(g => g.done).length;
        const rows = items.map(g => `
            <li class="goal-item ${g.done ? 'is-done' : ''}" data-goal-id="${g.id}">
                <button class="goal-check" data-gact="toggle" aria-label="Toggle goal">
                    <i data-lucide="${g.done ? 'check-circle-2' : 'circle'}"></i>
                </button>
                <span class="goal-text">${escapeHtml(g.text)}</span>
                <button class="goal-del" data-gact="delete" aria-label="Delete goal">
                    <i data-lucide="x"></i>
                </button>
            </li>`).join('');

        const emptyRow = items.length === 0
            ? `<li class="goal-empty">No targets yet — add one below</li>`
            : '';

        return `
        <section class="card goal-card" data-month-offset="${offset}">
            <header class="goal-card-head">
                <div class="goal-card-head-text">
                    <h3 class="goal-month">${monthName}</h3>
                    <span class="goal-range">${range}</span>
                </div>
                ${items.length ? `<span class="goal-count">${doneCount}/${items.length}</span>` : ''}
            </header>
            <ul class="goal-list">${rows}${emptyRow}</ul>
            <form class="goal-add-form" data-offset="${offset}" autocomplete="off">
                <i data-lucide="plus"></i>
                <input type="text" class="goal-add-input" maxlength="200" placeholder="Add a target…" />
            </form>
        </section>`;
    }).join('');
}

function wireGoalEvents() {
    const grid = $('#goalsGrid');
    if (!grid) return;

    // Delegate clicks on goal items
    grid.addEventListener('click', e => {
        const li = e.target.closest('[data-goal-id]');
        if (!li) return;
        const id = li.dataset.goalId;
        const act = e.target.closest('[data-gact]')?.dataset.gact;
        if (!act) return;
        if (act === 'toggle') {
            const g = state.goals.find(x => x.id === id);
            if (g) { g.done = !g.done; saveGoals(); renderGoals(); refreshIcons(); }
        }
        if (act === 'delete') {
            state.goals = state.goals.filter(x => x.id !== id);
            saveGoals(); renderGoals(); refreshIcons();
        }
    });

    // Delegate submit on add forms
    grid.addEventListener('submit', e => {
        const form = e.target.closest('.goal-add-form');
        if (!form) return;
        e.preventDefault();
        const input = form.querySelector('.goal-add-input');
        const text = input?.value.trim();
        if (!text) return;
        const offset = Number(form.dataset.offset);
        state.goals.push({ id: uid(), monthOffset: offset, text, done: false, created: Date.now() });
        saveGoals(); renderGoals(); refreshIcons();
        input.value = '';
        input.focus();
    });
}

function taskTemplate(t) {
    const subs = t.subtasks || [];
    const subDone = subs.filter(s => s.done).length;
    const subTotal = subs.length;
    const expanded = state.expanded.has(t.id);
    const addingSub = state.addingSubFor === t.id;

    const tally = subTotal ? `<span class="sub-tally">${subDone}/${subTotal}</span>` : '';
    const dur = t.duration ? `<span class="dur-pill"><i data-lucide="clock"></i>${fmtDuration(t.duration)}</span>` : '';
    const cat = '';

    const expandable = subTotal > 0 || addingSub || expanded;
    const chev = expandable
        ? `<button class="expand-btn" data-act="expand" aria-label="${expanded ? 'Collapse' : 'Expand'}"><i data-lucide="chevron-down"></i></button>`
        : `<button class="expand-btn" data-act="expand" aria-label="Add subtasks"><i data-lucide="chevron-down"></i></button>`;

    return `
    <li class="task ${t.done ? 'is-done' : ''} ${expanded ? 'is-expanded' : ''}" data-id="${t.id}">
      <button class="check" data-act="toggle" aria-label="Toggle done"><i data-lucide="check"></i></button>
      <span class="task-title-wrap">
        <span class="task-title">${escapeHtml(t.title)}</span>
        ${tally}
      </span>
      <span class="task-meta">
        ${dur}
        ${cat}
      </span>
      <span class="task-actions">
        <button class="addsub-btn" data-act="addsub" aria-label="Add subtask" title="Add subtask"><i data-lucide="list-plus"></i></button>
        ${chev}
        <button class="delete-btn" data-act="delete" aria-label="Delete"><i data-lucide="x"></i></button>
      </span>
    </li>
    ${expanded ? `
      <ul class="subtasks" data-parent="${t.id}">
        ${subs.map(s => `
          <li class="subtask ${s.done ? 'is-done' : ''}" data-sub-id="${s.id}">
            <button class="check" data-act="subtoggle" aria-label="Toggle subtask">
              <i data-lucide="check"></i>
            </button>
            <input class="subtask-title" data-act="subedit" value="${escapeHtml(s.title)}" maxlength="160" />
            <button class="subtask-del" data-act="subdelete" aria-label="Delete subtask"><i data-lucide="x"></i></button>
          </li>
        `).join('')}
        ${addingSub ? `
          <li class="subtask-input-row" data-parent="${t.id}">
            <span class="check" aria-hidden="true"></span>
            <input class="sub-new-input" placeholder="New subtask…" maxlength="160" autofocus />
          </li>
        ` : `
          <li><button class="subtask-add" data-act="addsub"><i data-lucide="plus"></i><span>Add a subtask</span></button></li>
        `}
      </ul>
    ` : ''}
  `;
}

function refreshIcons() {
    if (window.lucide?.createIcons) window.lucide.createIcons();
}

// ============== OPS — TASKS ==============
function addTask(title) {
    const t = {
        id: uid(),
        title: title.trim(),
        done: false,
        date: state.selectedDate,
        duration: null,
        category: '',
        subtasks: [],
        created: Date.now(),
    };
    if (!t.title) return;
    state.tasks.push(t);
    save(); renderAll();
}
function toggleTask(id) {
    const t = state.tasks.find(t => t.id === id);
    if (!t) return;
    t.done = !t.done;
    save(); renderAll();
}
function deleteTask(id) {
    state.tasks = state.tasks.filter(t => t.id !== id);
    state.expanded.delete(id);
    save(); renderAll();
}

// ============== OPS — SUBTASKS ==============
function toggleExpand(id) {
    const t = state.tasks.find(t => t.id === id);
    const subTotal = (t?.subtasks || []).length;
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    // If expanding a task without subtasks, also open the input row
    if (state.expanded.has(id) && subTotal === 0) state.addingSubFor = id;
    renderTodo(); refreshIcons();
    if (state.addingSubFor === id) {
        setTimeout(() => {
            const inp = document.querySelector(`.subtask-input-row[data-parent="${id}"] .sub-new-input`);
            inp?.focus();
        }, 20);
    }
}
function startAddSubtask(taskId) {
    state.addingSubFor = taskId;
    state.expanded.add(taskId);
    renderTodo(); refreshIcons();
    setTimeout(() => {
        const inp = document.querySelector(`.subtask-input-row[data-parent="${taskId}"] .sub-new-input`);
        inp?.focus();
    }, 20);
}
function cancelAddSubtask() {
    state.addingSubFor = null;
    renderTodo(); refreshIcons();
}
function addSubtask(taskId, title) {
    const t = state.tasks.find(t => t.id === taskId);
    if (!t || !title.trim()) return;
    if (!Array.isArray(t.subtasks)) t.subtasks = [];
    t.subtasks.push({ id: uid(), title: title.trim(), done: false });
    state.expanded.add(taskId);
    save(); renderTodo(); refreshIcons();
}
function toggleSubtask(taskId, subId) {
    const t = state.tasks.find(t => t.id === taskId);
    const s = t?.subtasks?.find(s => s.id === subId);
    if (!s) return;
    s.done = !s.done;
    save(); renderTodo(); refreshIcons();
}
function renameSubtask(taskId, subId, newTitle) {
    const t = state.tasks.find(t => t.id === taskId);
    const s = t?.subtasks?.find(s => s.id === subId);
    if (!s) return;
    const v = newTitle.trim();
    if (!v) t.subtasks = t.subtasks.filter(x => x.id !== subId);
    else s.title = v;
    save();
}
function deleteSubtask(taskId, subId) {
    const t = state.tasks.find(t => t.id === taskId);
    if (!t) return;
    t.subtasks = (t.subtasks || []).filter(s => s.id !== subId);
    save(); renderTodo(); refreshIcons();
}

// ============== TWEAKS ==============
function applyNotesCollapsed() {
    const collapsed = !!state.tweaks.notesCollapsed;
    const grid = document.querySelector('.page-grid');
    const card = $('#notesCard');
    const btn = $('#notesToggle');
    if (grid) grid.classList.toggle('notes-collapsed', collapsed);
    if (card) card.classList.toggle('is-collapsed', collapsed);
    if (btn) {
        btn.setAttribute('aria-expanded', String(!collapsed));
        btn.setAttribute('aria-label', collapsed ? 'Expand notes' : 'Collapse notes');
    }
}

function applyTweaks() {
    const app = $('#app');
    const t = state.tweaks;
    app.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    app.setAttribute('data-accent', t.accent);
    app.setAttribute('data-head', t.head);
    document.documentElement.setAttribute('data-head', t.head);

    $$('#accPicker .acc-dot').forEach(b => b.classList.toggle('is-active', b.dataset.acc === t.accent));
    $('#darkToggle').classList.toggle('is-on', t.dark);
    $('#darkToggle').setAttribute('aria-pressed', String(t.dark));
    $$('#segHead .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.head === t.head));
    applyNotesCollapsed();

    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        const accMap = { cyan: '#00A9DC', green: '#57A11F', navy: '#004081', plum: '#7B5EA7', orange: '#E2613B' };
        meta.setAttribute('content', t.dark ? '#0B0F14' : (accMap[t.accent] || '#00A9DC'));
    }
}
function setTweak(key, val) {
    state.tweaks[key] = val;
    saveTweaks();
    applyTweaks();
}

// ============== EVENTS ==============
function wireEvents() {
    // Tabs
    $$('.appbar-tabs .tab').forEach(b => {
        b.addEventListener('click', () => {
            state.tab = b.dataset.tab;
            $$('.appbar-tabs .tab').forEach(x => x.classList.toggle('is-active', x === b));
            $$('.view').forEach(v => v.hidden = v.dataset.view !== state.tab);
            refreshIcons();
        });
    });

    // Day prev/next
    $('#dayPrev').addEventListener('click', () => {
        state.selectedDate = isoDate(addDays(parseISO(state.selectedDate), -1));
        state.calMonth = parseISO(state.selectedDate);
        renderAll();
    });
    $('#dayNext').addEventListener('click', () => {
        state.selectedDate = isoDate(addDays(parseISO(state.selectedDate), 1));
        state.calMonth = parseISO(state.selectedDate);
        renderAll();
    });

    // Calendar nav
    $('#calPrev').addEventListener('click', () => {
        state.calMonth = addMonths(state.calMonth, -1);
        renderCalendar(); refreshIcons();
    });
    $('#calNext').addEventListener('click', () => {
        state.calMonth = addMonths(state.calMonth, 1);
        renderCalendar(); refreshIcons();
    });
    $('#calGrid').addEventListener('click', e => {
        const c = e.target.closest('.cal-cell');
        if (!c || c.classList.contains('is-empty')) return;
        state.selectedDate = c.dataset.date;
        renderAll();
    });

    // Notes (debounced save)
    let notesTimer;
    $('#notesArea').addEventListener('input', e => {
        state.notes = e.target.value;
        clearTimeout(notesTimer);
        notesTimer = setTimeout(saveNotes, 400);
    });

    // Filters
    $('#filterRow').addEventListener('click', e => {
        const b = e.target.closest('.pill');
        if (!b) return;
        state.filter = b.dataset.filter;
        $$('#filterRow .pill').forEach(x => x.classList.toggle('is-active', x === b));
        renderTodo(); refreshIcons();
    });

    // Add task
    $('#addTaskForm').addEventListener('submit', e => {
        e.preventDefault();
        const inp = $('#addTaskInput');
        addTask(inp.value);
        inp.value = '';
        inp.focus();
    });

    // Task list (delegated: tasks + subtasks)
    $('#taskList').addEventListener('click', e => {
        const subUl = e.target.closest('.subtasks');
        if (subUl) {
            const taskId = subUl.dataset.parent;
            const sub = e.target.closest('.subtask');
            const act = e.target.closest('[data-act]')?.dataset.act;
            if (act === 'subtoggle' && sub) return toggleSubtask(taskId, sub.dataset.subId);
            if (act === 'subdelete' && sub) return deleteSubtask(taskId, sub.dataset.subId);
            if (act === 'addsub') return startAddSubtask(taskId);
            return;
        }
        const li = e.target.closest('.task');
        if (!li) return;
        const id = li.dataset.id;
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'toggle') return toggleTask(id);
        if (act === 'delete') return deleteTask(id);
        if (act === 'expand') return toggleExpand(id);
        if (act === 'addsub') return startAddSubtask(id);
    });

    // Subtask inline editing (blur saves)
    $('#taskList').addEventListener('focusout', e => {
        const inp = e.target.closest('.subtask-title');
        if (!inp) return;
        const sub = inp.closest('.subtask');
        const subUl = inp.closest('.subtasks');
        if (!sub || !subUl) return;
        renameSubtask(subUl.dataset.parent, sub.dataset.subId, inp.value);
    });

    // Subtask input keyboard
    $('#taskList').addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            const newInp = e.target.closest('.sub-new-input');
            if (newInp) {
                e.preventDefault();
                const row = newInp.closest('.subtask-input-row');
                const taskId = row.dataset.parent;
                const val = newInp.value;
                if (val.trim()) {
                    addSubtask(taskId, val);
                    startAddSubtask(taskId);
                } else {
                    cancelAddSubtask();
                }
                return;
            }
            if (e.target.classList?.contains('subtask-title')) {
                e.preventDefault(); e.target.blur();
            }
        }
        if (e.key === 'Escape') {
            if (e.target.closest('.sub-new-input')) {
                e.preventDefault(); cancelAddSubtask();
            }
        }
    });

    // Tweaks panel
    $('#tweaksBtn').addEventListener('click', openTweaks);
    $('#tweaksClose').addEventListener('click', closeTweaks);
    $('#scrim').addEventListener('click', closeTweaks);
    $('#accPicker').addEventListener('click', e => {
        const b = e.target.closest('.acc-dot');
        if (!b) return;
        setTweak('accent', b.dataset.acc);
    });
    $('#darkToggle').addEventListener('click', () => setTweak('dark', !state.tweaks.dark));
    $('#notesToggle').addEventListener('click', () => setTweak('notesCollapsed', !state.tweaks.notesCollapsed));
    $('#segHead').addEventListener('click', e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        setTweak('head', b.dataset.head);
    });
    $('#tweaksReset').addEventListener('click', () => {
        state.tweaks = { ...DEFAULT_TWEAKS };
        saveTweaks(); applyTweaks();
        toast('Tweaks reset');
    });

    // Bell (placeholder)
    $('#bellBtn').addEventListener('click', () => toast('No notifications'));

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (isTyping(e)) return;
        if (e.key === 'n' || e.key === 'N') {
            e.preventDefault();
            $('#addTaskInput').focus();
        }
        if (e.key === 'd' || e.key === 'D') setTweak('dark', !state.tweaks.dark);
        if (e.key === 'Escape') closeTweaks();
    });
}

function isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function openTweaks() { $('#app').classList.add('is-tweaks-open'); $('#scrim').hidden = false; refreshIcons(); }
function closeTweaks() { $('#app').classList.remove('is-tweaks-open'); $('#scrim').hidden = true; }

function openAuthModal() {
    const user = currentUser();
    if (user) {
        // Already signed in → show profile / sign out
        const m = $('#authModal');
        m.dataset.mode = 'profile';
        $('#authTitle').textContent = 'Signed in';
        $('#authSub').textContent = user.displayName || user.email || '';
        $('#authBody').innerHTML = `
            <button class="btn btn-secondary btn-sm" id="authSignOutBtn" style="width:100%;justify-content:center;">
                <i data-lucide="log-out"></i><span>Sign out</span>
            </button>
        `;
        m.hidden = false;
        $('#scrim').hidden = false;
        refreshIcons();
        $('#authSignOutBtn').addEventListener('click', async () => {
            await cloudSignOut();
            closeAuthModal();
            toast('Signed out');
        });
        return;
    }
    const m = $('#authModal');
    m.dataset.mode = 'signin';
    $('#authTitle').textContent = 'Sign in to sync';
    $('#authSub').textContent = 'Your tasks, notes, and tweaks will live in your account.';
    $('#authBody').innerHTML = `
        <button class="btn btn-secondary auth-google" id="googleBtn">
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.4 4 9.8 8.3 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.2 35 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.4-2.4 4.4-4.5 5.6l6.2 5.2C40.6 35.6 44 30.3 44 24c0-1.3-.1-2.4-.4-3.5z"/>
            </svg>
            <span>Continue with Google</span>
        </button>
        <div class="auth-divider"><span>or</span></div>
        <form id="emailLinkForm" class="auth-email">
            <input type="email" id="emailInput" placeholder="you@example.com" required autocomplete="email" />
            <button class="btn btn-primary" type="submit">
                <i data-lucide="mail"></i><span>Email me a sign-in link</span>
            </button>
        </form>
    `;
    m.hidden = false;
    $('#scrim').hidden = false;
    refreshIcons();

    $('#googleBtn').addEventListener('click', async () => {
        try {
            await signInGoogle();
            closeAuthModal();
            toast('Signed in');
        } catch (e) {
            console.error(e);
            toast(e?.code === 'auth/popup-closed-by-user' ? 'Cancelled' : 'Sign-in failed');
        }
    });
    $('#emailLinkForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = $('#emailInput').value.trim();
        if (!email) return;
        try {
            await sendEmailLink(email);
            $('#authBody').innerHTML = `<p style="text-align:center;color:var(--fg-muted);font-size:14px;">Check <strong>${escapeHtml(email)}</strong> for a sign-in link.</p>`;
        } catch (err) {
            console.error(err);
            toast('Could not send link');
        }
    });
}

function closeAuthModal() {
    const m = $('#authModal');
    if (m) m.hidden = true;
    if (!$('#app').classList.contains('is-tweaks-open')) $('#scrim').hidden = true;
}

let toastTimer;
function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ============== BOOT ==============
init();
applyTweaks();
wireEvents();
wireGoalEvents();
renderAll();

// Show gate immediately — Firebase will call onAuthChange once it resolves
showAuthGate();

// Avatar → sign-in modal (only when already signed in)
$('#avatarBtn').addEventListener('click', openAuthModal);
$('#scrim').addEventListener('click', () => {
    // Only close auth modal, never close the gate
    if ($('#authModal') && !$('#authModal').hidden) closeAuthModal();
});

// Start Firebase auth listener (also handles cloud sync hook-up)
watchAuth(onAuthChange);

// Complete email-link sign-in if user arrived via magic link
completeEmailLinkIfPresent().catch(e => console.warn('email link complete', e));
