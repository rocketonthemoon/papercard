# UI polish plan

Branch `design-overhaul-flying-papers`, audited 2026-11-18. Every signed-in page was screenshotted at 1280px and 390px wide; the rules being measured against are in [DESIGN.md](DESIGN.md).

## Why it still feels unpolished

The individual screens are mostly fine. What makes the app feel unfinished is that **no two screens follow the same rules**:

1. **Two stylesheets fight each other.** `web/game.css` (the old theme: `--green`, `--navy`, soft shadows) loads first, and `web/design.css` overrides it with **1,259 `!important`s**. Every new rule has to out-shout an old one, so fixes don't stick and one-off values creep in.
2. **No enforced scale.** `design.css` uses 52 different hex colours, 24 font sizes, 5 border widths (0.5 / 1 / 1.5 / 2 / 2.5px) and 6 corner radii. DESIGN.md allows one border weight family and two radii (6px, 100px).
3. **Three heading voices.** Some card titles use Syne ("Daily Progress", "Play a friend", "Made by", "Decks (12)"), some use Inter Bold ("Lithuanian for students", "Nothing to review yet"), and section heads switch between the two at random. Syne is also loaded only at weight 700, but display headings ask for 800 or 900 (47 rules use those weights), so the browser fakes the bold.
4. **Buttons have no grammar.** The same "go" action is written five ways: `Start course →`, `Start Learning →`, `START A LESSON →`, `Continue →`, `Continue learning →`. Casing, arrows, fill and size change from page to page.

Fix the foundation first (phase 0). Otherwise each page fix in phases 2–3 becomes one more override.

---

## Phase 0: Foundation (do first)

- [x] **Tokens.** Add a single token block at the top of `design.css` and use only these:
  - Colours: the 9 palette colours in DESIGN.md, plus `--ink-60` (muted text) and `--line` (hairline). Every other hex value should map to one of these.
  - Type scale: 12 / 14 / 16 / 20 / 28 / 40 / clamp-display. Mono labels at 11 or 12 only.
  - Borders: `--bw: 2px` for cards, inputs and buttons; `--bw-hair: 1.5px` for dividers. Drop 0.5, 1 and 2.5.
  - Radii: `--r-card: 6px`, `--r-pill: 100px`. Change the stray 3, 4 and 8px values to one of those two.
  - Spacing: 4 / 8 / 12 / 16 / 24 / 32 / 48.
- [x] **Fold `game.css` into `design.css`.** Move across only the layout rules that are still used, delete the rest, and stop loading `game.css` in `web/index.html`. Then delete `!important`s in batches by page, re-checking each page as you go. Target: under 50, kept only where an inline style or third-party markup forces one.
- [x] **Fonts.** Load the Syne weights that are actually used (`wght@700;800`) or cap every Syne rule at 700. Decide which font does what:
  - **Syne** for page and section display headings, uppercase.
  - **Inter** for card titles and body.
  - **JetBrains Mono** for metadata labels only.

  Write this into DESIGN.md.
- [x] **Delete dead CSS.** Remove selectors that no longer match any markup; the landing features and philosophy rules removed earlier were one example. A quick check: grep each class in `design.css` against `game.js`.

## Phase 1: Things that are visibly broken

- [x] **Lesson footer overflows on phones.** At 390px the keyboard hint "Press 1-4 · Enter to check" runs off the left edge and the CHECK button is cut off on the right (`.lesson-foot`, `.foot-hint` at `design.css:3479`). Hide the keyboard hint under 600px; it's useless on touch anyway. Make CHECK full width.
- [x] **CHECK button `[ENTER]` chip.** It repeats the hint text right next to it. Keep one: drop the chip and keep the hint on desktop.
- [x] **Disabled CHECK is near-invisible** (light grey on cream). Use ink at 40% with a solid border so it reads as "not yet" rather than "missing".
- [x] **Words list columns don't line up** (`renderWords`, `game.js:2105`). The English column starts at a different x position for nouns, verbs and phrases because the POS tag width pushes it. Use a fixed grid: `[audio] [lt 1fr] [en 1fr] [tag auto] [status auto]`.
- [x] **Words list filter tabs.** "Learned / Due / Not yet" are dark text on dark violet and barely readable. Use the same segmented control as the Leaderboard Weekly/All toggle once that one is fixed (see phase 2).
- [x] **Course page deck list is cramped** (`renderCourse`, `game.js:2521`). Rows have no vertical padding, so text touches the dividers. The level label column shifts between A1 and A2 rows. Use 12px row padding and a fixed-width level column.
- [x] **Course page top bar says "COURSES"** while showing a single course. Show the course title, the way the course path page does.

## Phase 2: Consistency across the app

### Buttons
Define three variants and use nothing else:

| Variant | Look | Use for |
|---|---|---|
| Primary | Cream pill, 2px ink border, ink text | The one main action per screen |
| Secondary | Transparent, 2px Hi-Vis Yellow border, yellow text | Alternative actions on the violet stage |
| Quiet | Text link, underlined | Tertiary ("Select all", "Clear", "Suggest a change") |

- [x] Remove the **filled yellow** buttons ("Start course →" on Home, "Create a room" tile). DESIGN.md forbids a filled CTA.
- [x] **Sentence case everywhere**, with an arrow only on forward-moving actions: `Start course →`, `Continue →`, `Create room →`. No ALL-CAPS button labels (currently `START A LESSON →`, `EXPLORE COURSES`, `NEW COURSE →`, `SEARCH →`, `SIGN OUT`).
- [x] **One label per action.** Use "Continue →" once a course is started and "Start →" before that, on Home, Courses and the course page alike.
- [x] **One primary per screen.** The course page has two "Continue learning →" (top bar and hero); keep the hero one. "Leave course" is destructive, so make it a quiet link at the bottom of the page, not a yellow button beside the primary action.

### Pills, tags, badges
- [x] One pill style: mono 11px, 1.5px border, 100px radius, no brackets (brackets were removed in the last pass; keep it that way).
- [x] Level chips (A1/A2/B1) look the same everywhere. Right now they are yellow filled on the course path, plain text on the course page and bracketed in Play.
- [x] The "not yet" status pill on every row of the words list is noise. Show only **due** (highlighted) and **learned** (✓). "Not yet" is the default and needs no marker.

### Colour outside the palette
- [x] Profile **Sign out** uses an off-palette red outline with a pink fill. Make it a quiet link; sign-out is not a primary action.
- [x] The **verified badge** is blue (`I.verified`, `game.js:2204`). Recolour it to ink or yellow.
- [x] **Native radio buttons and checkboxes are browser blue** (Discover filters, Play deck picker). Style them with `accent-color: var(--color-ink-black)` at minimum, or custom 2px-border controls.
- [x] Leaderboard Weekly/All toggle: the unselected option is dark-on-dark. Selected should be cream on ink, unselected ink on cream.

### Headings
- [x] Card titles: Inter 20px/700, sentence case, everywhere (Daily Progress, Leaderboard, Quests, Your rooms, Made by, Decks, Play a friend).
- [x] Page display headings: the top-bar title is the page heading. Don't add a second one in the page body; the last pass removed these on Home, Review, Studio and Courses. Also remove "Your words · Lithuanian for students" (top bar already says YOUR WORDS) and "Play a friend" (top bar says PLAY).

## Phase 3: Page by page

**Home** (`renderEnrolledCourses`)
- [x] The enrolled course card has a green header block inside a cream card inside a border; on mobile the header is inset with double padding. Make it one flat card, with an accent fill on the header strip only.
- [x] Right column: Daily Progress, Leaderboard and Quests are three bordered boxes stacked with the same weight. Merge Daily Progress and Quests into one "Today" card. The leaderboard has its own page, so show only your rank here ("#4 this week →").

**Course path** (`renderCoursePath`)
- [x] The hero card repeats the course meta three times (LT chip, OFFICIAL, English → Lithuanian, 0/333 words, 12 decks). Keep the title, one meta line and the progress bar.
- [x] The "Unit 01/12" pill plus level pill plus chevron button is three bordered shapes in one header. Make the unit number plain mono text and the chevron a bare icon.
- [x] The "About course" yellow outline in the breadcrumb bar fights the breadcrumb. Move it to a quiet link.

**Lesson** (`renderLesson`)
- [x] The empty progress bar at the start reads as a dark slab; give it a cream track.
- [x] Set the question heading in the same face as other display headings (currently Syne in white, while everything else on the stage is yellow).
- [x] Answer options are pure white (`#fff`) while every other surface is bone (`#f9f5f2`). Use bone.

**Play** (`renderPlayHub`)
- [x] Twelve deck checkboxes push the Create button off screen, especially on mobile. Collapse each level group by default, with a summary line like "A1 · 1 of 5 selected".
- [x] "Create a room / Join a room" tiles use custom illustrations that don't match the line-icon set. Use the same icon style as the sidebar.
- [x] "Your rooms" empty state sits in a full card on its own; fold it into a single line under the form.

**Courses / Discover** (`renderDiscover`)
- [x] Filters moved above the results as a collapsible bar (collapsed by default, open state remembered, active-filter count in the header).
- [x] Hide filter groups that have only one option (Language: Lithuanian).
- [x] Style the active-filter chips ("Official ✕") as standard pills.

**Studio editor** (`drawStudio`)
- [x] Decks in the content tree collapse (chevron or click the deck row), with Collapse all / Expand all, remembered per course. Collapsed decks show their lesson count.

**Course page** (`renderCourse`): see phase 1 for the deck list and title. Also align the "LT" block, title and description on one baseline grid; at the moment they float.
- [x] Deck list padding (12px) and fixed-width level chips.
- [x] Baseline alignment for course title and description.

**Profile** (`renderProfile`)
- [x] The 80px avatar on mobile dominates the card. Use 56px.
- [x] Styled Sign out as a quiet link; removed off-palette pink/red.
- [x] "Your courses" + "New course" yellow outline + an empty card with "Open the Studio" link gives three ways to do one thing. Keep one empty-state line with a single link.

**Review, Studio, Leaderboard empty states**
- [x] Use one empty-state component everywhere: icon, one-line title, one short sentence, one primary button. Review currently has two buttons; Leaderboard's text is left-aligned while its button is centred.

## Phase 4: Mobile shell

- [x] The **app footer** (PAPERCARD · Apache 2.0 · GitHub) shows on every in-app page and sits behind the tab bar on phones. Show it only on the landing page.
- [x] Reserve the bottom tab bar's height on every page (`padding-bottom: calc(64px + env(safe-area-inset-bottom))`) so content never ends under it.
- [x] **Tap targets:** "Select all", "Clear", "Suggest a change" and the words-list audio icons are under 32px. Make them at least 44px tall on touch.
- [x] The **top bar** shows the wordmark plus streak, hearts and avatar, but no page title on mobile. Show the page title instead of the wordmark once signed in, because the tab bar already names the section.

## How to verify each phase

1. Screenshot every route at 1280 and 390 wide:
   - `#/learn`
   - `#/learn/course/1`
   - `#/learn/lesson/1`
   - `#/learn/review`
   - `#/learn/words`
   - `#/discover`
   - `#/course/1`
   - `#/play`
   - `#/leaderboard`
   - `#/studio`
   - `#/u/<you>`
   - landing (signed out)

   Use a container with `ALLOW_DEV_LOGIN=1` and `web/` mounted read-only so it auto-signs in.
2. Check for horizontal overflow: no element's right edge beyond `innerWidth`. Note that `overflow:hidden` hides clipping, so look at the lesson footer by eye.
3. Count `!important`s and distinct hex/font-size/radius values in `design.css`; they should only go down.
4. Check both themes if the theme toggle stays (there are `[data-theme="dark"]` rules).

## Already done (previous pass, uncommitted)

- Landing page rebuilt around visual demos (quiz, flip card, duel race) instead of text.
- Duplicate page headings removed on Home, Review, Studio and Courses.
- Locked course units collapse to a single header row, and the duplicate "Start Lesson" button is hidden.
- Removed the duplicate streak/hearts stats from Home and the garbled "120600" chart labels.
- Mobile: courses come before widgets on Home, unit headers stack, locked lesson rows simplified.
- Bracket wrappers stripped from 11 pill labels.

## Out of scope

- New features or copy rewrites beyond trimming.
- Admin page (`renderAdmin`), which wasn't audited. Give it a quick pass after phase 2, since it uses the same components.
