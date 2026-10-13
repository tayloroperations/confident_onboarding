/* Headless smoke test for the onboarding portal prototype.
 *   npm install jsdom && node verify.js
 * Exits non-zero on any failure, so it can gate a deploy.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const path = require('path');
const file = path.join(__dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');

const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://portal.local/',
  virtualConsole: new (require('jsdom').VirtualConsole)()
    .on('jsdomError', e => { if(!/Not implemented/.test(e.message)) errors.push('jsdomError: ' + e.message); })
    .on('error', (...a) => errors.push('console.error: ' + a.join(' ')))
});

const w = dom.window, d = w.document;
w.scrollTo = () => {};
const ok = [], bad = [];
const t = (name, cond, extra='') => (cond ? ok : bad).push(name + (extra ? ' — ' + extra : ''));

if (errors.length) errors.forEach(e => bad.push(e));

// --- boot ---
const app = d.getElementById('app');
t('#app exists', !!app);
t('#app rendered content', app && app.innerHTML.length > 2000, app ? app.innerHTML.length + ' chars' : '');

// --- logo ---
const logo = d.querySelector('.topbar .logo');
t('inline SVG logo present', logo && logo.tagName.toLowerCase() === 'svg');
t('logo has viewBox', logo && !!logo.getAttribute('viewBox'), logo ? logo.getAttribute('viewBox') : '');
t('logo wordmark is white', logo && logo.innerHTML.includes('#FFFFFF'));
t('logo keeps brand mark colors',
  logo && ['#F36344', '#5CCEFF', '#5237E9'].every(c => logo.innerHTML.includes(c)));
t('no base64 sentinel left', !html.includes('__LOGO'));

// --- globals the UI binds to ---
['render','setRole','setScope','openAmLab','toggle','openTask','addComment','openAdd','closeModal','submitAdd','saveState','loadState','resetState']
  .forEach(fn => t('fn ' + fn + '()', typeof w[fn] === 'function'));

// --- every inline handler resolves to a real function ---
const handlers = new Set();
d.querySelectorAll('*').forEach(el => {
  for (const a of el.attributes) {
    if (a.name.startsWith('on')) {
      const KEYWORDS = new Set(['if','for','while','switch','catch','return','typeof','function']);
      // Only bare calls are global functions. A call preceded by a dot is a method on
      // something else (event.preventDefault, this.parentNode.remove) and says nothing
      // about whether we defined a handler.
      const m = a.value.match(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || [];
      m.forEach(x => { const n = x.replace(/\s*\($/, ''); if (!KEYWORDS.has(n)) handlers.add(n); });
    }
  }
});
const missing = [...handlers].filter(h => typeof w[h] !== 'function');
t('all inline on* handlers defined', missing.length === 0, missing.join(', ') || [...handlers].length + ' distinct');

// --- data integrity ---
// top-level const/let live in the global lexical scope, not on window —
// reach them through a global eval rather than property access
const g = expr => w.eval(expr);
const LABS = g('LABS'), TASKS = g('TASKS'), PHASES = g('PHASES'), STATE = g('STATE');
t('LABS seeded', Array.isArray(LABS) && LABS.length > 0, LABS ? LABS.length + ' labs' : '');
t('every lab has tasks', LABS.every(l => Array.isArray(TASKS[l.slug]) && TASKS[l.slug].length));
t('every task has a known phase',
  LABS.every(l => TASKS[l.slug].every(x => PHASES.some(p => p.id === x.phase))));
t('every task has an ownerSide',
  LABS.every(l => TASKS[l.slug].every(x => x.ownerSide === 'lab' || x.ownerSide === 'confident')));
t('task ids unique',
  (() => { const all = LABS.flatMap(l => TASKS[l.slug].map(x => x.id)); return new Set(all).size === all.length; })());

// --- interaction: toggle a task ---
const slug = STATE.labSlug;
const first = TASKS[slug].find(x => x.status !== 'Done');
const before = TASKS[slug].filter(x => x.status === 'Done').length;
w.toggle(first.id);
t('toggle marks Done', TASKS[slug].find(x => x.id === first.id).status === 'Done');
t('toggle sets completedAt', !!TASKS[slug].find(x => x.id === first.id).completedAt);
t('toggle count +1', TASKS[slug].filter(x => x.status === 'Done').length === before + 1);
w.toggle(first.id);
t('toggle is reversible',
  TASKS[slug].find(x => x.id === first.id).status !== 'Done' &&
  TASKS[slug].find(x => x.id === first.id).completedAt === null);

// --- persistence ---
const raw = w.localStorage.getItem('confident-onboarding-portal/v2');
t('state written to localStorage', !!raw, raw ? raw.length + ' bytes' : '');
let parsed = null;
try { parsed = JSON.parse(raw); } catch (e) {}
t('saved state is valid JSON v2', parsed && parsed.v === 2);
t('saved state carries tasks + activity + view',
  parsed && parsed.tasks && parsed.activity && parsed.view);

// simulate a refresh: mutate, save, reload from the same storage
w.toggle(first.id);
const savedAfter = w.localStorage.getItem('confident-onboarding-portal/v2');
const dom2 = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://portal.local/',
  beforeParse(win) { win.scrollTo = () => {}; win.localStorage.setItem('confident-onboarding-portal/v2', savedAfter); }
});
t('state survives a reload',
  dom2.window.eval('TASKS')[slug].find(x => x.id === first.id).status === 'Done');
t('reload restores view state', dom2.window.eval('STATE').labSlug === slug);

// corrupt-storage resilience
const dom3 = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://portal.local/',
  beforeParse(win) { win.scrollTo = () => {}; win.localStorage.setItem('confident-onboarding-portal/v2', '{ not json'); }
});
t('corrupt storage falls back to seed',
  dom3.window.document.getElementById('app').innerHTML.length > 2000);

// --- AM view ---
w.setRole('am');
t('AM portfolio renders', app.innerHTML.length > 2000 && STATE.role === 'am');
const amHtml = app.innerHTML;
t('AM view lists multiple labs',
  LABS.filter(l => amHtml.includes(l.name)).length >= 3,
  LABS.filter(l => amHtml.includes(l.name)).length + ' lab names found');
w.openAmLab(LABS[0].slug);
t('AM lab detail renders', app.innerHTML.includes(LABS[0].name));
w.setRole('lab');
t('back to lab view', STATE.role === 'lab' && app.innerHTML.length > 2000);

// --- add-task modal ---
w.openAdd('lab');
const modal = d.getElementById('modal');
t('add-task modal populates', modal && modal.querySelector('form'));
t('modal has all fields',
  modal && ['title','desc','phase','side'].every(n => modal.querySelector(`[name="${n}"]`)));
t('v3: add-task modal no longer asks for a due date',
  modal && !modal.querySelector('[name="due"]'));
const form = modal.querySelector('form');
form.querySelector('[name="title"]').value = 'Verification smoke-test task';
const countBefore = TASKS[slug].length;
w.submitAdd({ preventDefault(){}, target: form }, 'lab', slug);
t('submitAdd appends a task', TASKS[slug].length === countBefore + 1);
t('new task appears in DOM', app.innerHTML.includes('Verification smoke-test task'));
t('new task logged to ACTIVITY', g('ACTIVITY')[0] && g('ACTIVITY')[0].txt.includes('Verification smoke-test'));

// --- comments ---
const withComments = TASKS[slug][0];
const cBefore = withComments.comments.length;
const fakeForm = d.createElement('form');
const inp = d.createElement('input'); inp.value = 'Smoke-test comment'; fakeForm.appendChild(inp);
w.addComment({ preventDefault(){}, target: fakeForm }, withComments.id);
t('addComment appends', withComments.comments.length === cBefore + 1);

// --- accessibility / brand spot-checks ---
t('lang attribute set', d.documentElement.getAttribute('lang'));
t('page has a title', d.title && d.title.length > 0, d.title);
t('logo has aria-label or title', logo && (logo.getAttribute('aria-label') || logo.querySelector('title')));
t('role switcher is a labelled group', !!d.querySelector('[role="group"][aria-label]'));
// Brand contract: coral is reserved for the next-action CTA and warning states.
// The rule it must not break is that coral is never a large surface.
const SURFACES = ['body','.wrap','.page','.card','.panel','.topbar','.hero','.rail','.task','.modal'];
const coralSurface = html.split('\n').filter(l =>
  /background\s*:[^;}]*(#F36344|var\(--coral\))/i.test(l) &&
  SURFACES.some(sel => new RegExp('(^|[,\\s{])' + sel.replace('.','\\.') + '[\\s{,]').test(l)));
t('Coral never used as a large surface', coralSurface.length === 0, coralSurface.join(' | '));
t('Coral is used for the next-action CTA', /\.nextcard[^}]*|background\s*:\s*var\(--coral\)/.test(html));
t('Work Sans loaded', /Work\+?\s?Sans/i.test(html));
t('JetBrains Mono loaded', /JetBrains\+?\s?Mono/i.test(html));

/* =====================================================================
   v2 checks
   The v2 surface is mostly modal-driven, and modals are rendered outside
   render(). That means a button can reference a handler that was never
   written and nothing complains until someone clicks it — which is exactly
   how four dangling references got shipped during the build. So these
   checks drive the real forms rather than poking at state directly.
   ===================================================================== */

const KW = new Set(['if','for','while','switch','catch','return','typeof','function']);
function scanHandlers(root){
  const found = new Set();
  root.querySelectorAll('*').forEach(el => {
    for (const a of el.attributes) {
      if (!a.name.startsWith('on')) continue;
      (a.value.match(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g) || [])
        .forEach(x => { const n = x.replace(/\s*\($/, ''); if (!KW.has(n)) found.add(n); });
    }
  });
  return [...found];
}

// --- normalizer + resolvers ---
t('every lab is normalized', LABS.every(l =>
  Array.isArray(l.users) && l.phaseNames && typeof l.phaseNames === 'object' &&
  Array.isArray(l.docBundle) && typeof l.internalNotes === 'string' &&
  typeof l.abbrev === 'string' && typeof l.state === 'string'));
t('phasesFor returns defaults with no override',
  w.eval('phasesFor({}).map(p=>p.name).join("|")') === PHASES.map(p => p.name).join('|'));
t('phasesFor applies an override',
  w.eval('phasesFor({phaseNames:{p3:"Data Handoff"}}).find(p=>p.id==="p3").name') === 'Data Handoff');
t('Help Articles link points at help.confidentlims.com',
  w.eval('LAB_LINKS(LABS[0]).some(x => x.title === "Help Articles" && /help\\.confidentlims\\.com/.test(x.url))'));
t('docsFor falls back to plan docs when the bundle is empty',
  w.eval('docsFor(LABS[0]).length') === w.eval('planDocs(LABS[0]).length'));

// --- completed labs ---
t('finished labs are seeded',
  LABS.filter(l => TASKS[l.slug] && TASKS[l.slug].length &&
    TASKS[l.slug].every(x => x.status === 'Done')).length >= 2);
w.setRole('am');
t('AM dashboard has a Completed labs section', app.innerHTML.includes('Completed labs'));
w.setRole('lab');

// --- collapsible phases ---
const pid = PHASES[0].id;
w.togglePhase(STATE.labSlug, pid);
t('togglePhase collapses a phase', !!d.querySelector('.phase[data-collapsed="1"]'));
w.togglePhase(STATE.labSlug, pid);
t('togglePhase is reversible', !d.querySelector('.phase[data-collapsed="1"]'));
t('collapse state stays out of saved state',
  !JSON.parse(w.localStorage.getItem('confident-onboarding-portal/v2')).collapsed);

// --- assignment ---
const atask = TASKS[STATE.labSlug].find(x => x.ownerSide === 'lab');
t('assignOptions offers the lab team',
  w.eval(`assignOptions(LABS.find(l=>l.slug==="${STATE.labSlug}"), findTask("${atask.id}").t)`)
    .some(o => /team$/.test(o)));
w.setAssignee(atask.id, 'Assignee Smoke Test');
t('setAssignee updates the task', atask.assignee === 'Assignee Smoke Test');
t('setAssignee logs to ACTIVITY', g('ACTIVITY')[0].kind === 'assigned');
t('setAssignee persists without a re-render',
  JSON.parse(w.localStorage.getItem('confident-onboarding-portal/v2'))
    .tasks[STATE.labSlug].find(x => x.id === atask.id).assignee === 'Assignee Smoke Test');

// --- user settings ---
w.setRole('am');
w.openUserSettings();
const uf = d.getElementById('modal').querySelector('form');
t('user settings form has name + role', !!(uf && uf.elements.name && uf.elements.role));
const oldAm = STATE.me.am.name;
uf.elements.name.value = 'Renamed AM';
uf.elements.role.value = 'Senior Account Manager';
w.submitUserSettings({ preventDefault(){}, target: uf }, 'am');
t('rename updates STATE.me', STATE.me.am.name === 'Renamed AM');
t('rename follows currentUser', STATE.currentUser === 'Renamed AM');
t('rename repoints owned labs', !LABS.some(l => l.am === oldAm));
t('rename carries existing assignments',
  !Object.keys(TASKS).some(s => TASKS[s].some(x => x.assignee === oldAm)));
w.openUserSettings();
const uf2 = d.getElementById('modal').querySelector('form');
uf2.elements.name.value = oldAm;
uf2.elements.role.value = 'Account Manager';
w.submitUserSettings({ preventDefault(){}, target: uf2 }, 'am');
t('rename is reversible', STATE.me.am.name === oldAm && STATE.currentUser === oldAm);

// --- create a lab ---
w.openNewLab();
const nf = d.getElementById('modal').querySelector('form');
t('new lab form has every field the spec asks for',
  ['name','abbrev','state','line','tier','slug','tmpl'].every(n => nf.elements[n]));
nf.elements.name.value   = 'Smoke Test Labs';
nf.elements.slug.value   = 'smoke-test-labs';
nf.elements.abbrev.value = 'stl';
nf.elements.state.value  = 'or';
nf.elements.line.value   = 'LIMS';
nf.elements.tier.value   = 'Premium';
nf.elements.tmpl.value   = w.eval('PHASE_TEMPLATES.find(p=>p.line==="LIMS"&&p.tier==="Premium").id');
const labsBefore = LABS.length;
w.submitNewLab({ preventDefault(){}, target: nf });
t('submitNewLab appends a lab', LABS.length === labsBefore + 1);
const nl = LABS.find(l => l.slug === 'smoke-test-labs');
t('new lab is normalized', !!(nl && Array.isArray(nl.users) && Array.isArray(nl.docBundle)));
t('new lab uppercases abbrev + state', nl.abbrev === 'STL' && nl.state === 'OR');
t('starting template seeds the checklist',
  (TASKS['smoke-test-labs'] || []).length > 0, (TASKS['smoke-test-labs'] || []).length + ' tasks');
t('seeded tasks start Not started',
  TASKS['smoke-test-labs'].every(x => x.status === 'Not started'));
t('seeded tasks record their provenance',
  TASKS['smoke-test-labs'].every(x => x.source === 'template'));
t('seeded tasks are ordered by phase',
  TASKS['smoke-test-labs'].every((x,i,a) =>
    i === 0 || PHASES.findIndex(p=>p.id===a[i-1].phase) <= PHASES.findIndex(p=>p.id===x.phase)));

w.openNewLab();
const nfDupe = d.getElementById('modal').querySelector('form');
nfDupe.elements.name.value = 'Duplicate Slug Lab';
nfDupe.elements.slug.value = 'smoke-test-labs';
const countPreDupe = LABS.length;
w.submitNewLab({ preventDefault(){}, target: nfDupe });
t('duplicate slug is refused', LABS.length === countPreDupe);
t('duplicate slug says why', /already taken/.test(d.getElementById('newlaberr').textContent));
w.closeModal();

// --- lab settings ---
w.openLabSettings('smoke-test-labs');
const sf = d.getElementById('modal').querySelector('form');
t('lab settings has a rename box per phase', PHASES.every(p => sf.elements['phase-' + p.id]));
t('lab settings lists selectable documents',
  sf.querySelectorAll('input[name="doc"]').length > 0);
sf.elements['phase-p3'].value = 'Data Handoff';
sf.querySelectorAll('input[name="doc"]')[0].checked = true;
w.submitLabSettings({ preventDefault(){}, target: sf }, 'smoke-test-labs');
t('phase rename is saved', nl.phaseNames.p3 === 'Data Handoff');
t('renamed phase resolves through phaseOfLab',
  w.eval('phaseOfLab(LABS.find(l=>l.slug==="smoke-test-labs"),"p3").name') === 'Data Handoff');
t('document bundle is saved', nl.docBundle.length === 1);
t('docsFor honours the bundle over the plan',
  w.eval('docsFor(LABS.find(l=>l.slug==="smoke-test-labs")).length') === 1);

w.openLabSettings('smoke-test-labs');
const sfBlank = d.getElementById('modal').querySelector('form');
sfBlank.elements['phase-p3'].value = '';
w.submitLabSettings({ preventDefault(){}, target: sfBlank }, 'smoke-test-labs');
t('a blank phase name drops the override, it does not store ""',
  !('p3' in nl.phaseNames));
t('clearing the rename does not clear the bundle', nl.docBundle.length === 1);

nl.users = ['Temp One', 'Temp Two'];
TASKS['smoke-test-labs'][0].assignee = 'Temp Two';
w.openLabSettings('smoke-test-labs');
const sfUsers = d.getElementById('modal').querySelector('form');
const urows = [...sfUsers.querySelectorAll('input[name="user"]')];
t('lab settings lists existing users', urows.length === 2, urows.length + ' rows');
urows[1].parentNode.remove();
w.submitLabSettings({ preventDefault(){}, target: sfUsers }, 'smoke-test-labs');
t('removing a user drops them', nl.users.length === 1 && nl.users[0] === 'Temp One');
t('a removed user hands their tasks back to the lab',
  TASKS['smoke-test-labs'][0].assignee === nl.name + ' team');

// --- internal notes ---
w.setRole('am');
w.openAmLab('smoke-test-labs');
const nb = d.getElementById('notes-smoke-test-labs');
t('internal notes box renders on the AM lab view', !!nb);
nb.value = 'Smoke test note.';
w.saveNotes('smoke-test-labs');
t('saveNotes stores on the lab', nl.internalNotes === 'Smoke test note.');
t('saveNotes persists',
  JSON.parse(w.localStorage.getItem('confident-onboarding-portal/v2')).labs
    .find(l => l.slug === 'smoke-test-labs').internalNotes === 'Smoke test note.');
STATE.labSlug = 'smoke-test-labs';
w.setRole('lab');
t('internal notes never render on the lab side', !app.innerHTML.includes('Smoke test note.'));

// --- template admin ---
w.setRole('am');
w.openTemplates();
const tmodal = d.getElementById('modal');
t('templates modal lists every phase template',
  w.eval('PHASE_TEMPLATES.map(p=>p.name)').every(n => tmodal.innerHTML.includes(n)));
t('templates modal offers an editor per task template',
  tmodal.querySelectorAll('button[onclick^="openTaskTemplate(\'tt"]').length ===
  w.eval('TASK_TEMPLATES.length'));

w.openTaskTemplate('');
const ttf = d.getElementById('modal').querySelector('form');
t('task template form has title/desc/phase/side',
  ['title','desc','phase','side'].every(n => ttf.elements[n]));
ttf.elements.title.value = 'Smoke task template';
ttf.elements.phase.value = 'p2';
ttf.elements.side.value  = 'confident';
const ttBefore = w.eval('TASK_TEMPLATES.length');
w.submitTaskTemplate({ preventDefault(){}, target: ttf }, '');
t('submitTaskTemplate creates', w.eval('TASK_TEMPLATES.length') === ttBefore + 1);
const newTT = w.eval('TASK_TEMPLATES[TASK_TEMPLATES.length-1]');
t('a hand-made task template is not builtin', newTT.builtin === false);
t('it lands in the chosen phase and side', newTT.phase === 'p2' && newTT.side === 'confident');

w.openTaskTemplate(newTT.id);
const ttEdit = d.getElementById('modal').querySelector('form');
t('task template edit form prefills', ttEdit.elements.title.value === 'Smoke task template');
ttEdit.elements.title.value = 'Smoke task template (edited)';
w.submitTaskTemplate({ preventDefault(){}, target: ttEdit }, newTT.id);
t('editing updates in place rather than appending',
  w.eval('TASK_TEMPLATES.length') === ttBefore + 1 &&
  w.eval(`TASK_TEMPLATES.find(x=>x.id==="${newTT.id}").title`) === 'Smoke task template (edited)');

w.openPhaseTemplate('');
const ptf = d.getElementById('modal').querySelector('form');
t('phase template form has name/product/plan', ['name','line','tier'].every(n => ptf.elements[n]));
t('phase template form has an editable row per phase',
  ptf.querySelectorAll('.phrow').length === PHASES.length,
  ptf.querySelectorAll('.phrow').length + ' rows');
t('each phase row carries a name and a due offset',
  [...ptf.querySelectorAll('.phrow')].every(r =>
    r.querySelector('[data-k="name"]') && r.querySelector('[data-k="off"]')));
t('phase template form lists task templates to pick',
  ptf.querySelectorAll('input[name="task"]').length === w.eval('TASK_TEMPLATES.length'));
t('every task row offers a phase picker',
  ptf.querySelectorAll('select[data-tt]').length === w.eval('TASK_TEMPLATES.length'));
ptf.elements.name.value = 'Smoke phase template';
[...ptf.querySelectorAll('.phrow')].pop().querySelector('[data-k="name"]').value = 'Go Live';
ptf.querySelector(`input[name="task"][value="${newTT.id}"]`).checked = true;
const ptBefore = w.eval('PHASE_TEMPLATES.length');
w.submitPhaseTemplate({ preventDefault(){}, target: ptf }, '');
t('submitPhaseTemplate creates', w.eval('PHASE_TEMPLATES.length') === ptBefore + 1);
const newPT = w.eval('PHASE_TEMPLATES[PHASE_TEMPLATES.length-1]');
t('phase template keeps its task picks', newPT.taskIds.includes(newTT.id));
t('phase template keeps its phase renames',
  newPT.phases[newPT.phases.length-1].name === 'Go Live');
t('phase template stores a due offset per phase',
  newPT.phases.every(p => typeof p.dueOffset === 'number'));

w.deleteTaskTemplate(newTT.id);
t('deleteTaskTemplate removes it', w.eval('TASK_TEMPLATES.length') === ttBefore);
t('deleting a task template clears it from every phase template',
  w.eval(`PHASE_TEMPLATES.every(p => !p.taskIds.includes("${newTT.id}"))`));
w.deletePhaseTemplate(newPT.id);
t('deletePhaseTemplate removes it', w.eval('PHASE_TEMPLATES.length') === ptBefore);

// --- v2 persistence ---
const rawV2 = JSON.parse(w.localStorage.getItem('confident-onboarding-portal/v2'));
t('saved state carries labs, templates and me',
  Array.isArray(rawV2.labs) && Array.isArray(rawV2.taskTemplates) &&
  Array.isArray(rawV2.phaseTemplates) && !!(rawV2.me && rawV2.me.am && rawV2.me.lab));
const dom4 = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://portal.local/',
  beforeParse(win){ win.scrollTo = () => {};
    win.localStorage.setItem('confident-onboarding-portal/v2',
      w.localStorage.getItem('confident-onboarding-portal/v2')); }
});
t('a created lab survives a reload',
  dom4.window.eval('LABS').some(l => l.slug === 'smoke-test-labs'));
t('its tasks survive a reload',
  (dom4.window.eval('TASKS')['smoke-test-labs'] || []).length > 0);
t('internal notes survive a reload',
  dom4.window.eval('LABS').find(l => l.slug === 'smoke-test-labs').internalNotes === 'Smoke test note.');
t('template stores refill in place, not by reassignment',
  dom4.window.eval('TASK_TEMPLATES.length') === ttBefore &&
  dom4.window.eval('PHASE_TEMPLATES.length') === ptBefore);
t('ids resume past the restored high-water mark',
  dom4.window.eval('TMPL_ID') >= ttBefore && dom4.window.eval('TASK_ID') > 0);

// --- every modal's handlers resolve ---
const modalMissing = [];
[['user settings',  () => w.openUserSettings()],
 ['add task',       () => w.openAdd('lab')],
 ['new lab',        () => w.openNewLab()],
 ['lab settings',   () => w.openLabSettings('smoke-test-labs')],
 ['templates',      () => w.openTemplates()],
 ['task template',  () => w.openTaskTemplate('')],
 ['phase template', () => w.openPhaseTemplate('')]
].forEach(([label, open]) => {
  open();
  scanHandlers(d.getElementById('modal'))
    .forEach(h => { if (typeof w[h] !== 'function') modalMissing.push(label + ' → ' + h + '()'); });
});
t('all modal on* handlers defined', modalMissing.length === 0, modalMissing.join(', '));
w.closeModal();


/* =====================================================================
   v3 checks
   The V3 pass moved dates from tasks to phases, gave phases to templates,
   and added deletion. Each of those changes a rule rather than adding a
   widget, so these drive the rule from both sides — the allowed case and
   the refused one — rather than checking that a button exists.
   ===================================================================== */

// Deletion confirms in-page rather than through window.confirm, which an embedded
// frame suppresses — so these drive the real modal.

// --- dates moved off tasks and onto phases ---
t('v3: no task anywhere still carries a dueDate',
  LABS.every(l => (TASKS[l.slug]||[]).every(x => x.dueDate === undefined)));
t('v3: every task carries a linearUrls array',
  LABS.every(l => (TASKS[l.slug]||[]).every(x => Array.isArray(x.linearUrls))));
t('v3: every lab carries the phase + v3 config slots', LABS.every(l =>
  Array.isArray(l.phases) && l.phases.length && l.phaseDue && typeof l.phaseDue === 'object' &&
  Array.isArray(l.industries) && typeof l.statusNote === 'string' &&
  typeof l.linearUrl === 'string' && typeof l.sentiment === 'string' &&
  typeof l.archived === 'boolean'));
t('v3: every phase carries a numeric dueOffset',
  LABS.every(l => l.phases.every(p => typeof p.dueOffset === 'number')));

const L0 = LABS.find(l => l.slug === 'northgate-analytical');
const P0 = w.eval('phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))')[0];
t('v3: phaseDue computes from the lab start plus the offset',
  w.eval(`phaseDue(LABS.find(l=>l.slug==="northgate-analytical"), phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))[0])`)
    === new Date(new Date(L0.start+'T12:00:00Z').getTime() + P0.dueOffset*864e5).toISOString().slice(0,10));
L0.phaseDue[P0.id] = '2099-01-01';
t('v3: a per-lab override beats the computed date',
  w.eval(`phaseDue(LABS.find(l=>l.slug==="northgate-analytical"), phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))[0])`) === '2099-01-01');
t('v3: a future phase date is not overdue',
  w.eval(`phaseOverdue(LABS.find(l=>l.slug==="northgate-analytical"), phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))[0])`) === false);
L0.phaseDue[P0.id] = '2020-01-01';
const p0Open = (TASKS['northgate-analytical']||[]).some(x => x.phase === P0.id && x.status !== 'Done');
t('v3: a past phase date with open work is overdue',
  w.eval(`phaseOverdue(LABS.find(l=>l.slug==="northgate-analytical"), phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))[0])`) === p0Open,
  p0Open ? 'phase has open work' : 'phase already complete, correctly not flagged');
// a phase with nothing left open is never overdue, however old its date
(TASKS['northgate-analytical']||[]).filter(x => x.phase === P0.id).forEach(x => { x.status = 'Done'; });
t('v3: a finished phase is never overdue, however old the date',
  w.eval(`phaseOverdue(LABS.find(l=>l.slug==="northgate-analytical"), phasesFor(LABS.find(l=>l.slug==="northgate-analytical"))[0])`) === false);
delete L0.phaseDue[P0.id];

// --- the rendered surfaces ---
w.setRole('lab'); STATE.labSlug = 'northgate-analytical'; w.render();
t('v3: task rows no longer print a due date',
  !/class="task-date">Due/.test(app.innerHTML));
t('v3: the only "Due" on the page is the phase header',
  (app.innerHTML.match(/>Due \d{4}-/g)||[]).length ===
  (app.innerHTML.match(/class="phase-due[^"]*">Due \d{4}-/g)||[]).length);
t('v3: the phase header prints the date instead',
  /class="phase-due/.test(app.innerHTML));
t('v3: lab view splits Add task from Request help',
  app.innerHTML.includes('+ Add task') && app.innerHTML.includes('Request help'));
t('v3: Request help is a mailto to the support inbox',
  /href="mailto:support@confidentlims\.com\?subject=/.test(app.innerHTML));
t('v3: the per-task help link carries the task as context',
  /Request help with this task/.test(app.innerHTML));

// --- lab links ---
const links = w.eval('LAB_LINKS(LABS.find(l=>l.slug==="northgate-analytical"))');
t('v3: lab login points at app.confidentlims.com',
  links.some(x => x.url === 'https://app.confidentlims.com/'));
t('v3: pricing link added', links.some(x => x.url === 'https://www.confidentlims.com/pricing'));
t('v3: API docs link added', links.some(x => x.url === 'https://api.confidentlims.com/v0/docs/'));
t('v3: the templated links substitute the lab slug, not the placeholder',
  links.some(x => /redirectToPath=orders\/new\/samples\?lab=northgate-analytical$/.test(x.url)) &&
  links.some(x => /login\?lab=northgate-analytical$/.test(x.url)) &&
  !links.some(x => /labslug/.test(x.url)));

// --- deletion: the rule, from both sides ---
const tmplTask = TASKS['northgate-analytical'].find(x => x.source === 'template');
const ownTask  = TASKS['northgate-analytical'].find(x => x.source === 'lab-created');
t('v3: a lab may not delete a template task', w.canDeleteTask(tmplTask, 'lab') === false);
t('v3: a lab may delete a task it raised itself', w.canDeleteTask(ownTask, 'lab') === true);
t('v3: an AM may delete anything', w.canDeleteTask(tmplTask, 'am') === true);
const cntBefore = TASKS['northgate-analytical'].length;
w.deleteTask(tmplTask.id, 'lab');
t('v3: the lab-side delete is refused in the handler too, not just the UI',
  TASKS['northgate-analytical'].length === cntBefore);
w.deleteTask(ownTask.id, 'lab');
t('v3: the lab-side delete goes through for its own task',
  TASKS['northgate-analytical'].length === cntBefore - 1 &&
  !TASKS['northgate-analytical'].some(x => x.id === ownTask.id));
t('v3: a deletion is logged to ACTIVITY', g('ACTIVITY')[0].kind === 'deleted');
// the confirmation is page UI, not window.confirm (which an embedded viewer suppresses)
t('v3: the page never calls window.confirm', !/[^.\w]confirm\s*\(/.test(html));
const delTask = TASKS['northgate-analytical'].find(x => x.source === 'template');
w.openDeleteTask(delTask.id, 'am');
const delModal = d.getElementById('modal');
t('v3: the delete confirmation is rendered in the page',
  delModal.innerHTML.includes('Delete this task?') && delModal.innerHTML.includes(delTask.title));
t('v3: the confirmation offers a way out', /onclick="closeModal\(\)"/.test(delModal.innerHTML));
// clear the modal first, or the previous dialog's markup would be read as this one's
w.closeModal(); d.getElementById('modal').innerHTML = '';
w.openDeleteTask(TASKS['northgate-analytical'].find(x => x.source === 'template').id, 'lab');
t('v3: the lab side never even opens the confirmation for a template task',
  d.getElementById('modal').innerHTML === '');
w.closeModal();
w.setRole('am'); w.openAmLab('northgate-analytical');
t('v3: the lab view hides the delete control on template tasks',
  (() => { w.setRole('lab'); w.render();
    const n = (app.innerHTML.match(/task-del/g)||[]).length;
    const own = TASKS['northgate-analytical'].filter(x => x.source === 'lab-created').length;
    return n === own; })(), 'one control per lab-raised task');
w.setRole('am'); w.openAmLab('northgate-analytical');
t('v3: the AM view offers a delete control on every task',
  (app.innerHTML.match(/task-del/g)||[]).length === TASKS['northgate-analytical'].length);

// --- Linear ticket links, Confident side only ---
const lt = TASKS['northgate-analytical'][0];
const lf = d.createElement('form');
const lu = d.createElement('input'); lu.name = 'url';
lu.value = 'https://linear.app/confident/issue/ENG-9001/smoke'; lf.appendChild(lu);
w.addLinear({preventDefault(){}, target: lf}, lt.id);
t('v3: addLinear attaches the ticket', lt.linearUrls.includes('https://linear.app/confident/issue/ENG-9001/smoke'));
t('v3: the ticket renders by its identifier, not the raw URL',
  w.eval(`linearLabel("https://linear.app/confident/issue/ENG-9001/smoke")`) === 'ENG-9001');
t('v3: the AM view shows the linked ticket', app.innerHTML.includes('ENG-9001'));
w.setRole('lab'); STATE.labSlug = 'northgate-analytical'; w.render();
t('v3: the lab view never shows a Linear ticket', !app.innerHTML.includes('ENG-9001'));
w.setRole('am'); w.openAmLab('northgate-analytical');
w.removeLinear(lt.id, lt.linearUrls.indexOf('https://linear.app/confident/issue/ENG-9001/smoke'));
t('v3: removeLinear detaches it', !lt.linearUrls.includes('https://linear.app/confident/issue/ENG-9001/smoke'));

// --- portfolio: tags, status note, Linear project ---
w.setRole('am'); STATE.amLab = null; w.setScope('all'); w.render();
t('v3: industry tags render in the portfolio', app.innerHTML.includes('class="tag"'));
t('v3: the status note renders under the lab name',
  app.innerHTML.includes('Waiting on a regulator response about the new matrix rule'));
t('v3: the Linear project link renders in the portfolio', app.innerHTML.includes('linearicon'));
t('v3: the overdue chip names the phase rather than counting tasks',
  !/\d+ overdue<\/span>/.test(app.innerHTML));
w.setRole('lab'); STATE.labSlug = 'clearwater-testing'; w.render();
t('v3: a status note never reaches the lab side',
  !app.innerHTML.includes('Waiting on a regulator response about the new matrix rule'));

// --- AM sentiment on a finished onboarding ---
w.setRole('am'); STATE.amLab = null; w.render();
t('v3: completed labs offer a sentiment picker', app.innerHTML.includes('class="sentiment"'));
w.setSentiment('saltflat-analytics', 'rough');
t('v3: setSentiment stores on the lab',
  LABS.find(l=>l.slug==='saltflat-analytics').sentiment === 'rough');
t('v3: sentiment persists without a re-render',
  JSON.parse(w.localStorage.getItem('confident-onboarding-portal/v2')).labs
    .find(l => l.slug === 'saltflat-analytics').sentiment === 'rough');

// --- the post-onboarding survey ---
w.setRole('lab'); STATE.labSlug = 'northgate-analytical'; w.render();
t('v3: no survey while the checklist is unfinished', !app.innerHTML.includes('Post-onboarding survey'));
STATE.labSlug = 'cedar-fork-labs'; w.render();
t('v3: the survey appears once every task is done', app.innerHTML.includes('Post-onboarding survey'));

// --- archiving ---
w.setRole('am'); STATE.amLab = null; w.setScope('all'); w.render();
const archTarget = 'prairie-state-testing';
const inPortfolioBefore = app.innerHTML.includes('Prairie State Testing');
w.openArchiveLab(archTarget);
const af = d.getElementById('modal').querySelector('form');
af.elements.confirm.value = 'wrong name';
w.submitArchiveLab({preventDefault(){}, target: af}, archTarget);
t('v3: archiving is refused when the typed name does not match',
  LABS.find(l=>l.slug===archTarget).archived === false);
t('v3: the refusal says why', /does not match/.test(d.getElementById('archerr').textContent));
af.elements.confirm.value = 'Prairie State Testing';
w.submitArchiveLab({preventDefault(){}, target: af}, archTarget);
t('v3: the typed name archives the lab', LABS.find(l=>l.slug===archTarget).archived === true);
w.setScope('all'); w.render();
t('v3: an archived lab leaves the portfolio table',
  inPortfolioBefore && !app.innerHTML.includes(`openAmLab('${archTarget}')`));
t('v3: an archived lab is listed under Archived labs', app.innerHTML.includes('Archived labs'));
t('v3: its tasks are kept, not destroyed', (TASKS[archTarget]||[]).length > 0);
w.restoreLab(archTarget);
t('v3: restore puts it back', LABS.find(l=>l.slug===archTarget).archived === false);

// --- phase templates: add, refuse, move, remove ---
w.openTemplates();
const ptId = w.eval('PHASE_TEMPLATES[0].id');
w.openPhaseTemplate(ptId);
const phBefore = d.getElementById('modal').querySelectorAll('.phrow').length;
w.addTemplatePhase(ptId);
t('v3: addTemplatePhase adds a row',
  d.getElementById('modal').querySelectorAll('.phrow').length === phBefore + 1);
t('v3: the new phase is offered to every task picker',
  [...d.getElementById('modal').querySelectorAll('select[data-tt]')]
    .every(sel => sel.options.length === phBefore + 1));
// removing a phase that still holds selected tasks is refused
const firstPid = d.getElementById('modal').querySelector('.phrow').dataset.pid;
const rowsBefore = d.getElementById('modal').querySelectorAll('.phrow').length;
w.removeTemplatePhase(ptId, firstPid);
t('v3: removing a phase that still holds tasks is refused',
  d.getElementById('modal').querySelectorAll('.phrow').length === rowsBefore);
t('v3: the refusal explains what to do',
  /Move them to another phase first/.test(d.getElementById('pterr').textContent));
// the empty phase just added can go
const lastPid = [...d.getElementById('modal').querySelectorAll('.phrow')].pop().dataset.pid;
w.removeTemplatePhase(ptId, lastPid);
t('v3: an empty phase can be removed',
  d.getElementById('modal').querySelectorAll('.phrow').length === rowsBefore - 1);

// moving a task to another phase sticks through a save
w.openPhaseTemplate(ptId);
const mf = d.getElementById('modal').querySelector('form');
const movePids = [...mf.querySelectorAll('.phrow')].map(r => r.dataset.pid);
const moveSel = mf.querySelector('select[data-tt]');
const moveTT = moveSel.dataset.tt;
const moveTo = movePids.find(x => x !== moveSel.value);
moveSel.value = moveTo;
w.submitPhaseTemplate({preventDefault(){}, target: mf}, ptId);
t('v3: a moved task keeps its new phase on the template',
  w.eval(`PHASE_TEMPLATES.find(p=>p.id==="${ptId}").taskPhase["${moveTT}"]`) === moveTo);

// --- a lab snapshots its template's phases ---
w.openNewLab();
const snapF = d.getElementById('modal').querySelector('form');
snapF.elements.name.value = 'Snapshot Labs';
snapF.elements.slug.value = 'snapshot-labs';
snapF.elements.tmpl.value = ptId;
w.submitNewLab({preventDefault(){}, target: snapF});
const snapLab = LABS.find(l => l.slug === 'snapshot-labs');
t('v3: a new lab takes its own copy of the template phases',
  !!snapLab && snapLab.phases.length === w.eval(`PHASE_TEMPLATES.find(p=>p.id==="${ptId}").phases.length`));
t('v3: the snapshot is a copy, not a shared reference',
  snapLab.phases !== w.eval(`PHASE_TEMPLATES.find(p=>p.id==="${ptId}").phases`));
const snapNameBefore = snapLab.phases[0].name;
w.eval(`PHASE_TEMPLATES.find(p=>p.id==="${ptId}").phases[0].name = "Renamed after the fact"`);
t('v3: editing the template later does not reshape the live lab',
  snapLab.phases[0].name === snapNameBefore);
t('v3: a task moved in the template lands in that phase on the new lab',
  (TASKS['snapshot-labs']||[]).length > 0 &&
  TASKS['snapshot-labs'].every(x => snapLab.phases.some(p => p.id === x.phase)));

// --- the COA example ---
t('v3: a COA template example task ships in the library',
  w.eval('TASK_TEMPLATES.some(t => /COA template example/i.test(t.title))'));
t('v3: it carries the worked example document',
  w.eval('TASK_TEMPLATES.find(t => /COA template example/i.test(t.title)).docs.includes("coaExample")'));

// --- lab settings exposes the v3 fields ---
w.openLabSettings('northgate-analytical');
const v3f = d.getElementById('modal').querySelector('form');
t('v3: lab settings has a due-date box per phase',
  LABS.find(l=>l.slug==='northgate-analytical').phases.every(p => v3f.elements['due-'+p.id]));
t('v3: lab settings exposes industries, status note and Linear',
  v3f.querySelectorAll('input[name="industry"]').length === w.eval('INDUSTRIES.length') &&
  !!v3f.elements.statusNote && !!v3f.elements.linearUrl);
v3f.elements.statusNote.value = 'Smoke status note.';
v3f.elements.linearUrl.value  = 'https://linear.app/confident/project/smoke';
v3f.querySelectorAll('input[name="industry"]').forEach(i => { i.checked = false; });
v3f.querySelectorAll('input[name="industry"]')[0].checked = true;
v3f.elements['due-'+P0.id].value = '2027-02-02';
w.submitLabSettings({preventDefault(){}, target: v3f}, 'northgate-analytical');
t('v3: the status note saves', L0.statusNote === 'Smoke status note.');
t('v3: the Linear project saves', L0.linearUrl === 'https://linear.app/confident/project/smoke');
t('v3: the industry tag saves', L0.industries.length === 1);
t('v3: the phase date override saves', L0.phaseDue[P0.id] === '2027-02-02');
w.openLabSettings('northgate-analytical');
const v3f2 = d.getElementById('modal').querySelector('form');
v3f2.elements['due-'+P0.id].value = '';
w.submitLabSettings({preventDefault(){}, target: v3f2}, 'northgate-analytical');
t('v3: clearing a phase date drops the override rather than storing ""',
  !(P0.id in L0.phaseDue));
w.closeModal();

// --- every v3 modal's handlers resolve ---
const v3Missing = [];
[['archive lab',    () => w.openArchiveLab('northgate-analytical')],
 ['phase template', () => w.openPhaseTemplate(ptId)],
 ['lab settings',   () => w.openLabSettings('northgate-analytical')],
 ['new lab',        () => w.openNewLab()]
].forEach(([label, open]) => {
  open();
  scanHandlers(d.getElementById('modal'))
    .forEach(h => { if (typeof w[h] !== 'function') v3Missing.push(label + ' → ' + h + '()'); });
});
t('v3: all new modal on* handlers defined', v3Missing.length === 0, v3Missing.join(', '));
w.closeModal();

// --- v3 state survives a reload ---
w.saveState();
const dom5 = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://portal.local/',
  beforeParse(win){ win.scrollTo = () => {};
    win.localStorage.setItem('confident-onboarding-portal/v2',
      w.localStorage.getItem('confident-onboarding-portal/v2')); }
});
t('v3: lab phases survive a reload',
  (dom5.window.eval('LABS').find(l => l.slug === 'snapshot-labs') || {}).phases.length > 0);
t('v3: the status note survives a reload',
  dom5.window.eval('LABS').find(l => l.slug === 'northgate-analytical').statusNote === 'Smoke status note.');
t('v3: template phases survive a reload',
  dom5.window.eval(`PHASE_TEMPLATES.find(p=>p.id==="${ptId}").phases.length`) > 0);
t('v3: no reloaded task carries a dueDate',
  dom5.window.eval('Object.values(TASKS).every(a => a.every(x => x.dueDate === undefined))'));

console.log('\n  PASS (' + ok.length + ')');
ok.forEach(x => console.log('   ok   ' + x));
console.log('\n  FAIL (' + bad.length + ')');
bad.forEach(x => console.log('   XX   ' + x));
console.log('\n' + (bad.length ? '  ✗ ' + bad.length + ' failing' : '  ✓ all ' + ok.length + ' checks passed'));
process.exit(bad.length ? 1 : 0);
