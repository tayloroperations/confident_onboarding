# Confident Onboarding Portal — prototype

A single-file, no-build prototype of the lab onboarding portal described in
`../Onboarding-Portal-Project-Outline.md`. Open `index.html` in any browser —
from a file path, a static host, or a shared link. There is no server, no
package to install, and no compile step.

It exists to make the argument in the outline concrete: that a lab should be
able to open one page cold and know, within about five seconds, what they need
to do next and who they are waiting on.

## What's in the folder

| File | What it is |
|---|---|
| `index.html` | The entire application — markup, styles, seed data, and logic in one file |
| `verify.js` | A headless smoke test (200 checks) that fails loudly if the page breaks |
| `README.md` | This file |

## Running it

Double-click `index.html`. That is the whole procedure.

For a local server — worth doing if you want to test on a phone on the same
network, since `file://` URLs don't share well:

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Running the tests

```
npm install jsdom
node verify.js
```

It exits non-zero on failure, so it can gate a deploy. The suite covers the
render path, the logo, every inline event handler resolving to a real function,
seed-data integrity (phases, owner sides, unique task IDs), task toggling and
its reversal, localStorage save/reload/corruption-recovery, both role views,
the add-task modal end to end, comments, and a handful of brand and
accessibility constraints.

The v3 block at the end drives the rules the V3 pass introduced from *both*
sides — the permitted case and the refused one — because each of those changes
a rule rather than adding a widget. A lab is shown to be unable to delete a
template task, not merely to lack the button; archiving is shown to refuse a
mismatched confirmation; removing a phase that still holds tasks is shown to be
refused with an explanation.

Two of those checks are worth knowing about because they encode judgement
rather than mechanics. One asserts that Coral is never used as a large surface
— the brand contract reserves it for the next-action CTA and warning states, so
the test allows those two uses and forbids the rest. The other walks every
`on*` attribute in the document and confirms the function it names actually
exists, which is the failure mode a hand-written single-file app is most prone
to.

## How to drive the demo

The portal opens in **Lab view** as Northgate Analytical — a LIMS Pro lab about
halfway through onboarding. The top-right switcher flips to **Account manager**,
which lands on the portfolio across all eleven active labs; clicking any row
opens that lab's checklist as the AM sees it.

Things worth clicking in a walkthrough:

- The **next-action card** at the top of the lab view. It is the answer to
  "what do I do now", and it is the only Coral surface on the page.
- **Phase headers carry the dates.** Individual tasks no longer have due dates
  at all; a phase shows its date and goes Overdue when that date has passed and
  it still has unfinished work. Open Lab settings to override a phase date.
- **Tick a task**, then refresh the browser. The state persists.
- **Expand a task** to see its instructions, attached documents, contextual
  help-center links, and comment thread — the mechanism that replaces "the AM
  explains it on a call".
- **Add a task** from either side. On the lab side this is now separate from
  **Request help**, which opens a prefilled mail to the support inbox — there is
  also a per-task help link inside each expanded task.
- **Delete a task.** The control only appears where the rule allows it: a lab
  may remove what the lab itself raised, an AM may remove anything. See the
  note below on why.
- **Archive a lab** from its AM detail view. It leaves the portfolio, keeps its
  checklist, and can be restored from the bottom of the portfolio.
- In AM view, the **scope toggle** widens from assigned labs to all labs, and
  the stalled rows are flagged in the portfolio table. The AM column only
  appears under "All labs" — under "My labs" every row would name the same
  person.
- **Templates → a phase template** now edits the phase list itself: rename,
  reorder by adding and removing, set each phase's due offset in days from the
  lab's start, and move a task template into a different phase.
- **Reset demo** in the top bar clears saved state and reloads from seed.

## What is real and what is staged

Real, and carried over from the current-state audit: the two product lines and
six tiers, the document bundles per tier, the help-center article targets, and
the templated Lab Links with the `labslug` placeholder substituted per lab.

**Every lab name, contact name and status note in the seed data is invented.**
Earlier drafts carried the real lab names over from the audit; they were
replaced when this repo became the source for a public deploy. The portfolio
attaches internal commentary to whatever name sits next to it — status notes, AM
sentiment, "no reply to the last three emails" — and none of that commentary is
true. It exists to populate the UI. Keep it that way: if you ever repoint this
at real accounts, the deploy has to stop being public first.

Staged, and flagged as such in the source: **the nineteen template task titles
are placeholders.** They were invented to give the checklist a plausible shape
and they are not the real rows from Notion — those weren't retrievable in the
structural read of the checklist databases. Pulling them is a small job and
should happen before anyone reads the task list as authoritative. The Notion
data sources are recorded in `../HANDOFF.md`.

Also staged: phases. The four phases here (Kickoff & Access, Lab Configuration,
Data & Methods, Validation & Go-Live) are a reasonable reading of the tier
onboarding plans, not a definition anyone has agreed to. They don't exist in
the current Notion schema at all, which is precisely the gap the outline
argues needs closing.

## Why a lab cannot delete every task

Progress is `done / total`. If a lab could delete any task on its checklist, the
denominator would shrink with it and a lab could delete its way to 100%
complete — while the AM portfolio reported the onboarding as finished. So
deletion is gated on provenance, which every task already records: a lab may
delete tasks it raised itself (`source: 'lab-created'`), and nothing else. An
account manager may delete anything. The rule lives in one function,
`canDeleteTask`, which both the button and the handler consult, so the UI and
the enforcement can never drift apart.

## Architectural honesty

This prototype fakes three things that the real product cannot fake, and it is
worth being explicit about which.

**There is no auth.** The role switcher is a toggle, not a login. Anyone with
the URL sees every lab. This is fine for a demo and disqualifying for anything
else — which is why auth and permissions sit in Phase 1 of the outline rather
than being deferred to polish.

**There is no shared state.** localStorage is per-browser. If a lab ticks a
task, no one at Confident sees it; the AM view is reading the same local copy,
not the lab's. The single most important claim in the outline — one shared
checklist both sides read and write — is the one thing a static file
structurally cannot deliver. It needs a backend.

**Nothing is sent anywhere.** No Slack notification and no file upload. Request
help is a `mailto:` — it opens the lab's own mail client against the support
inbox, which means the request genuinely leaves the portal: the AM view never
learns it happened, and "Waiting on" will not reflect it until someone replies
by email. That is a deliberate choice for this pass, not an oversight.

**Six items on the V3 list are deliberately absent**, because a static file
cannot do them and faking them would be worse than leaving them out: file
uploads on tasks, the signed service-agreement upload, lab-uploaded reference
documents, AM status notes genuinely shared between account managers (the ones
here are per-browser like everything else), Slack notifications, and the
HubSpot automation that creates a lab and assigns an AM on deploy. All six need
the Supabase backend, which is its own project.

The point of saying this plainly is that the prototype is good evidence for the
*interface* decisions and no evidence at all for the *system* decisions. Those
are in `../Phase-1-Architecture.md`.

## Conventions if you edit it

The file is ordered: CSS custom properties and styles, then markup shell, then
seed data, then render functions, then interactions, then boot. Rendering is
string templates assigned to `innerHTML` — there is no framework and no virtual
DOM, so every mutation calls `render()` and repaints the app container.

`render()` holds the scroll position by default; navigation passes
`render({top:true})` to jump to the top. Every call persists through
`saveState()`, so any new mutation gets persistence for free as long as it ends
in a render.

All user-supplied strings go through `esc()` before reaching a template. Adding
an interpolation without it is the one change most likely to introduce a real
bug, since task titles and comments are free text.

The logo is an inline SVG rather than a linked or base64 asset — crisp at any
size, no network request, and it survives the file being emailed around. The
wordmark paths are recoloured to white for the Deep Purple top bar; the three
brand-mark paths keep `#F36344`, `#5CCEFF`, and `#5237E9`.

Colours are CSS custom properties at the top of the file. Use them rather than
hex literals, both for consistency and because `verify.js` reasons about
`var(--coral)` when it checks the brand constraint.
