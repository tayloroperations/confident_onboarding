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
  modal && ['title','desc','phase','side','due'].every(n => modal.querySelector(`[name="${n}"]`)));
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
t('phase template form has a rename box per phase',
  PHASES.every(p => ptf.elements['phase-' + p.id]));
t('phase template form lists task templates to pick',
  ptf.querySelectorAll('input[name="task"]').length === w.eval('TASK_TEMPLATES.length'));
ptf.elements.name.value = 'Smoke phase template';
ptf.elements['phase-p4'].value = 'Go Live';
ptf.querySelector(`input[name="task"][value="${newTT.id}"]`).checked = true;
const ptBefore = w.eval('PHASE_TEMPLATES.length');
w.submitPhaseTemplate({ preventDefault(){}, target: ptf }, '');
t('submitPhaseTemplate creates', w.eval('PHASE_TEMPLATES.length') === ptBefore + 1);
const newPT = w.eval('PHASE_TEMPLATES[PHASE_TEMPLATES.length-1]');
t('phase template keeps its task picks', newPT.taskIds.includes(newTT.id));
t('phase template keeps its phase renames', newPT.phaseNames.p4 === 'Go Live');

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

console.log('\n  PASS (' + ok.length + ')');
ok.forEach(x => console.log('   ok   ' + x));
console.log('\n  FAIL (' + bad.length + ')');
bad.forEach(x => console.log('   XX   ' + x));
console.log('\n' + (bad.length ? '  ✗ ' + bad.length + ' failing' : '  ✓ all ' + ok.length + ' checks passed'));
process.exit(bad.length ? 1 : 0);
