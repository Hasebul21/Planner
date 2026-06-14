// ============================================================
// Planner — app logic (vanilla ES module)
// Top app bar shell · calendar · notes · to-do with subtasks · tweaks
// ============================================================

const STORAGE_KEY = 'cefalo.planner.v3';
const TWEAKS_KEY = 'cefalo.planner.tweaks.v1';
const NOTES_KEY = 'cefalo.planner.notes.v1';

const DEFAULT_TWEAKS = {
    accent: 'cyan',
    dark: false,
    head: 'aesthetic',
    density: 'regular',
    radius: 'soft',
};

// ============== STATE ==============
const state = {
    tab: 'today',                // today | goals
    filter: 'all',               // all | open | done
    tasks: [],
    notes: '',
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
}
function loadNotes() {
    try { return localStorage.getItem(NOTES_KEY) || ''; }
    catch (e) { return ''; }
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
    refreshIcons();
}

function renderHead() {
    const now = new Date();
    $('#greet').textContent = `${greetingFor(now)}, Sofia`;
    const sel = parseISO(state.selectedDate) || new Date();
    const isToday = sameDay(sel, new Date());
    $('#pageTitle').textContent = isToday ? 'Today' : sel.toLocaleDateString(undefined, { weekday: 'long' });
    $('#pageDate').textContent = fmtLongDate(sel);

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

function taskTemplate(t) {
    const subs = t.subtasks || [];
    const subDone = subs.filter(s => s.done).length;
    const subTotal = subs.length;
    const expanded = state.expanded.has(t.id);
    const addingSub = state.addingSubFor === t.id;

    const tally = subTotal ? `<span class="sub-tally">${subDone}/${subTotal}</span>` : '';
    const dur = t.duration ? `<span class="dur-pill"><i data-lucide="clock"></i>${fmtDuration(t.duration)}</span>` : '';
    const cat = t.category ? `<span class="cat-pill">${escapeHtml(t.category)}</span>` : '';

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
function applyTweaks() {
    const app = $('#app');
    const t = state.tweaks;
    app.setAttribute('data-theme', t.dark ? 'dark' : 'light');
    app.setAttribute('data-accent', t.accent);
    app.setAttribute('data-density', t.density);
    app.setAttribute('data-radius', t.radius);
    app.setAttribute('data-head', t.head);
    document.documentElement.setAttribute('data-head', t.head);

    $$('#accPicker .acc-dot').forEach(b => b.classList.toggle('is-active', b.dataset.acc === t.accent));
    $('#darkToggle').classList.toggle('is-on', t.dark);
    $('#darkToggle').setAttribute('aria-pressed', String(t.dark));
    $$('#segHead .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.head === t.head));
    $$('#segDensity .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.density === t.density));
    $$('#segRadius .seg-btn').forEach(b => b.classList.toggle('is-active', b.dataset.radius === t.radius));

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
    $('#segHead').addEventListener('click', e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        setTweak('head', b.dataset.head);
    });
    $('#segDensity').addEventListener('click', e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        setTweak('density', b.dataset.density);
    });
    $('#segRadius').addEventListener('click', e => {
        const b = e.target.closest('.seg-btn'); if (!b) return;
        setTweak('radius', b.dataset.radius);
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
renderAll();
