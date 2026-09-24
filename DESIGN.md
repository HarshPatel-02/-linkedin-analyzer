---
name: LinkedIn AI Analyzer
description: Prospect scores and AI outreach drafts that sit inside LinkedIn as if LinkedIn had built them.
colors:
  linkedin-blue: "#0a66c2"
  linkedin-blue-hover: "#004182"
  linkedin-blue-tint: "rgba(10,102,194,.1)"
  on-blue: "#ffffff"
  selected-green: "#01754f"
  on-green: "#ffffff"
  band-ok: "#057642"
  band-warn: "#915907"
  band-bad: "#cc1016"
  band-ok-tint: "rgba(5,118,66,.1)"
  band-warn-tint: "rgba(145,89,7,.1)"
  band-bad-tint: "rgba(204,16,22,.08)"
  badge-red: "#cc1016"
  card-white: "#ffffff"
  text-primary: "rgba(0,0,0,.9)"
  text-secondary: "rgba(0,0,0,.6)"
  divider-grey: "#e8e8e8"
  outline-grey: "rgba(0,0,0,.6)"
  hover-wash: "rgba(0,0,0,.08)"
  linkedin-blue-dark: "#71b7fb"
  linkedin-blue-hover-dark: "#a8d4ff"
  linkedin-blue-tint-dark: "rgba(113,183,251,.15)"
  on-blue-dark: "rgba(0,0,0,.9)"
  selected-green-dark: "#7fc15e"
  on-green-dark: "rgba(0,0,0,.9)"
  band-ok-dark: "#7fc15e"
  band-warn-dark: "#e7a33e"
  band-bad-dark: "#f5987e"
  band-ok-tint-dark: "rgba(127,193,94,.14)"
  band-warn-tint-dark: "rgba(231,163,62,.14)"
  band-bad-tint-dark: "rgba(245,152,126,.14)"
  card-dark: "#1b1f23"
  text-primary-dark: "rgba(255,255,255,.9)"
  text-secondary-dark: "rgba(255,255,255,.6)"
  divider-dark: "#38434f"
  outline-dark: "rgba(255,255,255,.6)"
  hover-wash-dark: "rgba(255,255,255,.08)"
typography:
  display:
    fontFamily: "inherit (LinkedIn page font); popup: -apple-system, system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, Arial, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    fontFeature: "tnum"
  headline:
    fontFamily: "inherit"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  title:
    fontFamily: "inherit"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "20px"
  body:
    fontFamily: "inherit"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "inherit"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "0"
  caption:
    fontFamily: "inherit"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.33
rounded:
  bar: "2px"
  input: "4px"
  card: "8px"
  badge: "9px"
  pill: "24px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.linkedin-blue}"
    textColor: "{colors.on-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.linkedin-blue-hover}"
    textColor: "{colors.on-blue}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.linkedin-blue}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.linkedin-blue-tint}"
    textColor: "{colors.linkedin-blue-hover}"
  button-muted:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
    height: "32px"
  button-muted-hover:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.text-primary}"
  button-profile-trigger:
    backgroundColor: "transparent"
    textColor: "{colors.linkedin-blue}"
    typography: "{typography.title}"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
    height: "32px"
  filter-pill:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    height: "28px"
  filter-pill-selected:
    backgroundColor: "{colors.selected-green}"
    textColor: "{colors.on-green}"
    rounded: "{rounded.pill}"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.circle}"
    size: "32px"
  chip:
    backgroundColor: "{colors.hover-wash}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
    height: "24px"
  chip-band-ok:
    backgroundColor: "{colors.band-ok-tint}"
    textColor: "{colors.band-ok}"
    rounded: "{rounded.pill}"
  chip-band-warn:
    backgroundColor: "{colors.band-warn-tint}"
    textColor: "{colors.band-warn}"
    rounded: "{rounded.pill}"
  chip-band-bad:
    backgroundColor: "{colors.band-bad-tint}"
    textColor: "{colors.band-bad}"
    rounded: "{rounded.pill}"
  verdict-pill:
    backgroundColor: "{colors.band-ok-tint}"
    textColor: "{colors.band-ok}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
  score-numeral:
    textColor: "{colors.band-ok}"
    typography: "{typography.display}"
  card:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "12px 24px 24px"
  input:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "6px 12px"
    height: "32px"
  tab:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    typography: "{typography.label}"
    height: "44px"
  tab-active:
    textColor: "{colors.selected-green}"
  count-badge:
    backgroundColor: "{colors.badge-red}"
    textColor: "#ffffff"
    rounded: "{rounded.badge}"
    padding: "0 5px"
    height: "18px"
  suggestion-row:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
  callout-memo:
    backgroundColor: "{colors.linkedin-blue-tint}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "8px 12px"
  callout-error:
    backgroundColor: "{colors.band-bad-tint}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "12px 16px"
---

# Design System: LinkedIn AI Analyzer

## Overview

**Creative North Star: "The Native Section"**

Every surface this extension draws should read as one more section LinkedIn itself ships, sitting beside "About" and "Activity" on a profile, beside the composer in messaging, inside the Connect dialog. The system is borrowed on purpose: LinkedIn's white 8px cards with a faint ring, its inherited page font, its blue pill buttons, its grey hairlines, its green selected pills and red count badge. The extension owns no brand chrome inside LinkedIn's page; its identity is its content (numbered signals, points, a running total, a band-coloured score and verdict) rather than its skin.

Density is LinkedIn's working density: 14px body, 12px meta, 32px controls, 8 to 24px padding. The score page keeps a ledger's structure (numbered rows, points against a maximum, a running total, a closing score) but draws it with LinkedIn's table language: sentence-case grey headers, hairline row rules, tabular numbers, and blue segment bars. Light and dark follow LinkedIn: in-page surfaces switch with the page (`data-li-theme`), the toolbar popup with `prefers-color-scheme`, and both use LinkedIn's own dark palette rather than an inverted one.

The confirmed rejection is the extension's previous own-world skins (the "Passbook Ledger" paper-and-cover styling and the earlier split-view widget look): anything that makes the panels look like a product other than LinkedIn clashes on a live profile.

**Key Characteristics:**
- LinkedIn's palette only; no extension-owned hue.
- Inherited page font in-page; LinkedIn's system stack in the popup.
- White 8px cards with a 1px ring, no resting drop shadow.
- Every action is a 24px-radius pill: primary blue, secondary blue outline, muted grey outline.
- Sentence case everywhere; no uppercase, no letter-spacing.
- Score bands carry meaning in green, amber and red wherever a score appears.

## Colors

LinkedIn's own working palette: one blue for action, one green for selection, red for counts, and three band inks that exist only to say how good a score is.

### Primary
- **LinkedIn Blue** (`linkedin-blue`; dark `linkedin-blue-dark`): every action. Primary pill fill, secondary pill text and outline, links inside signal details, the lit segments of the score bars, focus rings. Hover deepens to **LinkedIn Blue Deep** (`linkedin-blue-hover`), and the **Blue Wash** tint (`linkedin-blue-tint`) fills secondary-pill hover and the pain-point memo in the ✨ popup.

### Secondary
- **Selected Green** (`selected-green`; dark `selected-green-dark`): LinkedIn's filter-pill green. The selected Casual/Pro tone pill in the ✨ popup and the active tab's text and 2px underline in the toolbar popup. Nothing else.

### Tertiary
- **Band Inks** (`band-ok`, `band-warn`, `band-bad`, each with a `-tint` and `-dark` variant): LinkedIn's success, warning and error inks, mapped to score bands 70–100 / 40–69 / below 40. The ink colours the 32px score numeral, the verdict pill text and the popup lead chips; the tint fills the verdict pill and band chips. Warn tint also backs the "missing data" note on a score card; bad tint backs the ✨ error callout.
- **Badge Red** (`badge-red`): the notification-style count badge on the Follow-ups tab. It stays red in dark mode, as LinkedIn's does.

### Neutral
- **Card White / Card Dark** (`card-white`, `card-dark`): every card, popup and input ground.
- **Primary Text** (`text-primary`): names, signal labels, figures, body copy.
- **Secondary Text** (`text-secondary`): meta lines, table headers, form labels, row numbers, dimmed zero figures, muted pill text, close and icon buttons.
- **Divider Grey** (`divider-grey`; dark `divider-dark`): row hairlines, section rules, the unlit segments of score bars, scrollbar thumbs.
- **Outline Grey** (`outline-grey`): input borders and the muted pill outline.
- **Hover Wash** (`hover-wash`): hover fill on muted pills, icon buttons, tabs and suggestion rows; also the neutral chip ground.

### Named Rules
**The Borrowed Palette Rule.** Every colour is one LinkedIn already uses on the same page. If a value can't be found in LinkedIn's own UI, it does not belong here.

**The Band Ink Rule.** Green, amber and red mean score band and nothing else: 70+ ok, 40–69 warn, below 40 bad, applied the same way everywhere a score appears (panel numeral, verdict pill, popup lead chips).

**The Blue Acts, Green Selects Rule.** Primary actions are always blue. Selected Green marks a chosen option or active tab and is never a button fill for an action.

## Typography

**Display Font:** inherited from the LinkedIn page (`font-family: inherit`) for every in-page surface
**Body Font:** same inherited face; the toolbar popup uses LinkedIn's system stack (-apple-system, system-ui, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica Neue, … Arial, sans-serif)

**Character:** No face of its own. The extension speaks in whatever LinkedIn is rendering, at LinkedIn's sizes and weights, so a panel title and LinkedIn's "About" title are the same voice.

### Hierarchy
- **Display** (600, 32px, 1.25, tabular): the score numeral only, in band ink, followed by a 14px secondary "/ 100".
- **Headline** (600, 20px, 1.4): card titles, "Activity score" and "ICP fit", matching LinkedIn section titles.
- **Title** (600, 16px): the prospect name on a score card, the toolbar popup title, and the two profile trigger pills (sized to sit beside LinkedIn's own "Message" button).
- **Body** (400, 14px, 1.43): body copy, signal labels (600), figures (600, tabular), inputs, suggestion rows, form labels (in secondary text), "Next step" lines capped at 56ch.
- **Label** (600, 14px, 20px line): pill buttons, tabs, filter pills, verdict pill, popup section heads.
- **Caption** (400 or 600, 12px): table column headers (600), signal details, meta lines, chips (600), row numbers, the card foot, label qualifiers in forms.

### Named Rules
**The Inherited Voice Rule.** In-page surfaces never declare a font family; they inherit LinkedIn's. Sizes use `!important` only to survive LinkedIn's own resets.

**The Sentence Case Rule.** Titles, column headers, labels, buttons and verdicts are sentence case with zero letter-spacing ("Needs nurturing", "Industry match"); acronyms stay capitalised ("ICP", "EHR"). No uppercase styling anywhere.

**The Tabular Figures Rule.** Every number that lines up with another (points, max, running total, score, day count) uses tabular numerals.

## Layout

In-page cards take the full width of LinkedIn's main column and stack with 8px vertical margin, like LinkedIn's own sections. A card is a title row (20px top, 24px left, 16px right to seat the 32px close button) over a body padded 12px 24px 24px that scrolls past 80vh. The score page runs: name and company line with actions right-aligned; an optional warning note; the signal table (# / Signal / Points / Max / Total, 10px 8px cells, numbers right-aligned); a hairline; then the closing grid of score numeral with "Next step" on the left and the verdict pill on the right; then a 12px caption foot. Under a 460px container width the closing grid stacks, the verdict pill moves left, actions drop under the name, and the Max column is hidden.

Edit forms use a two-column grid (16px row gap, 24px column gap) of stacked label-over-field pairs, collapsing to one column under 660px viewport; full-width fields span both columns; actions sit right-aligned in a row 16px below.

The toolbar popup is 380px wide: a 16px-padded header with the title and three equal-width 44px tabs, then a scrolling main area (12px 16px 16px, max 500px) of hairline-divided list rows. The pitch form's action row is sticky at the bottom with a top hairline so Save stays in view.

Spacing rhythm is 4 / 8 / 12 / 16 / 24px: 4 inside label pairs, 8 between pills, 12 between blocks, 16 for popup edges and form groups, 24 for card edges.

## Elevation & Depth

Flat, LinkedIn-style. Cards at rest carry a 1px ring made with `box-shadow` rather than a border or drop shadow. Only surfaces that float over LinkedIn's UI (the ✨ popup above the composer or note box) add a soft lift beneath the ring. Buttons draw their outlines as inset box-shadows, which thicken from 1px to 2px on hover, so outlines never shift layout.

### Shadow Vocabulary
- **Card ring** (`box-shadow: 0 0 0 1px rgba(140,140,140,.2)`; dark `.3`): every in-page card and the ✨ popup.
- **Float lift** (`box-shadow: 0 4px 12px rgba(0,0,0,.15)`; dark `0 4px 16px rgba(0,0,0,.5)`): added to the ring on the ✨ popup only.
- **Pill outline** (`box-shadow: inset 0 0 0 1px var(--ln-blue)` or `var(--ln-line)`, 2px on hover): secondary, muted, trigger and filter pills.

### Named Rules
**The Ring, Not Shadow Rule.** A resting surface gets the 1px ring and nothing more. Lift is reserved for things that float over LinkedIn's own controls.

## Shapes

Three corner sizes, each with one job: fully rounded pills (24px) for every button, filter, chip and verdict; 8px for cards, suggestion rows and tinted callouts; 4px for text inputs. Icon buttons (close, refresh) are 32px circles. Small geometry repeats the same logic: score segment bars are 14×4px with 2px ends and 3px gaps (one segment per 5 possible points), the count badge is an 18px capsule. No hard corners, no hard offset shadows, no borders heavier than 1px except the 2px hover outline and 2px focus ring.

### Named Rules
**The Pill Action Rule.** If it can be pressed, it is a pill (or a circle for icon-only). Rectangles are for containers and fields.

## Components

### Buttons
Quiet, familiar and LinkedIn-sized: nothing that would look foreign next to "Follow" and "Message".
- **Shape:** full pill (24px radius), 32px minimum height, 6px 16px padding, 14px/600 label, optional 12px stroke SVG icon with 6px gap.
- **Primary:** LinkedIn Blue fill, white text (dark: light blue fill, near-black text). Calculate, Save, Export CSV, Open profile.
- **Secondary:** transparent with a 1px LinkedIn Blue inset outline and blue text. Edit details / Edit keywords, Done, the "✨ AI note" pill.
- **Muted:** transparent with a 1px grey outline and secondary text. Save keywords, Clear; in the popup, Clear turns its outline and text red on hover to warn.
- **Hover / Focus:** primary deepens to LinkedIn Blue Deep; outlined pills gain the tint (blue or grey wash) and a 2px outline. Transitions are 167ms on background, box-shadow and colour. Keyboard focus is a 2px LinkedIn Blue outline offset 2px (inset -2px on tabs). Disabled is 50% opacity.
- **Profile triggers:** the two secondary pills injected into the profile action row, at 16px to match LinkedIn's adjacent profile buttons.

### Chips
- **Style:** 24px capsule, 2px 10px padding, 12px/600. Neutral chips (keyword count) use Hover Wash and secondary text.
- **State:** band chips in the popup lead list use the band tint with band ink text.

### Filter pills (✨ popup)
- **Style:** 28px pill, 4px 12px padding, grey outline, secondary text; used for the Casual/Pro tone switch and the Improve / Shorten / Fix grammar draft actions.
- **Selected:** Selected Green fill with white text (dark: green fill, near-black text), no outline, marked with `aria-pressed`.

### Cards / Containers
- **Corner Style:** 8px.
- **Background:** Card White / Card Dark.
- **Shadow Strategy:** card ring only (see Elevation).
- **Border:** none; hairline rules inside.
- **Internal Padding:** 24px sides in-page, 16px in the popup and ✨ popup.
- **Callouts:** 8px-radius tinted blocks, 8px 12px padding, primary text: Blue Wash for the pain-point memo, warn tint for missing-data notes, bad tint for errors (with a muted Retry pill beneath).

### Inputs / Fields
- **Style:** 1px Outline Grey border, 4px radius, card background, 6px 12px padding, 32px minimum (textareas 64–72px, resizable vertically, capped at 190px in-page). Labels sit above in 14px secondary text with optional 12px qualifiers.
- **Hover:** a 1px outer ring doubles the border.
- **Focus:** border and ring switch to primary text colour (LinkedIn's dark focus edge); no glow.
- **Read-only:** secondary text colour.

### Navigation (toolbar popup tabs)
- **Style:** three equal-width 44px tabs, 14px/600 secondary text, no background.
- **Hover:** Hover Wash and primary text.
- **Active:** Selected Green text with a 2px inset green underline.
- **Count:** a red 18px capsule badge with white 12px/600 figure after the label.

### List rows (toolbar popup)
Hairline-divided rows, 12px vertical padding: 14px/600 name, 12px secondary meta ("Message sent 5d ago · no reply yet"), 14px pre-wrapped message text, then pill actions 10px below. Empty states are centred secondary text in a 24px-padded row.

### Score card (signature component)
The ledger structure in LinkedIn's skin. Numbered signal rows (zero-padded "01" in 12px secondary), each with a 600 label, an optional 12px detail line (links in blue), and a row of segment bars lit in LinkedIn Blue for points earned; Points, Max and a running Total in tabular figures on the right, zero points dimmed. The close states the score as a 32px band-ink numeral over "/ 100", a bold "Next step:" sentence, and a verdict pill (band tint ground, band ink text, 4px 12px, 14px/600) that carries the user-confirmed band emoji. Activity and ICP cards are identical in skin and told apart only by their titles.

### ✨ AI popup
A floating 8px card with ring and lift, anchored above the composer or the Connect note box. A sticky header row (title with the ✨ glyph, tone filter pills, circular refresh and close icon buttons) over a hairline; then the draft actions row, the optional pain-point memo, a 14px/600 secondary section head, and suggestion rows: full-width 8px-radius blocks with a 1px divider border that take Hover Wash and an outline-grey border on hover, and insert into the composer on click. The composer launcher is a 32px circular ✨ icon button left of LinkedIn's image button.

## Do's and Don'ts

### Do:
- **Do** take every colour from the `--ln-*` (in-page) or popup token set, in both light and dark, and switch with LinkedIn's theme rather than inverting.
- **Do** make every action a 24px-radius pill at 32px height: blue fill for the one primary action in a row, blue outline for secondary, grey outline for muted.
- **Do** colour a score and its verdict by band everywhere it appears: 70+ `band-ok`, 40–69 `band-warn`, below 40 `band-bad`, ink on text and tint behind pills.
- **Do** keep every breakdown row and its points visible, with tabular figures and segment bars (one segment per 5 possible points).
- **Do** write titles, headers, labels, buttons and verdicts in sentence case, and let in-page text inherit LinkedIn's font.
- **Do** give resting cards only the 1px ring (`0 0 0 1px rgba(140,140,140,.2)`); add the lift only to surfaces floating over LinkedIn's controls.
- **Do** use Selected Green only for a selected filter pill or the active tab.
- **Do** draw icons as single-stroke inline SVGs that follow `currentColor`.

### Don't:
- **Don't** reintroduce own-brand chrome inside LinkedIn: no paper grounds, coloured covers, guilloche or ledger styling, no custom fonts, no violet or other off-palette accents.
- **Don't** tell Activity and ICP apart by colour; their titles do that.
- **Don't** use emoji in UI chrome, headings or status lines. The only exceptions are user-confirmed: the band emoji inside verdict labels (🟢 / 🟡 / 🔴) and the ✨ glyph that names the AI feature.
- **Don't** use uppercase or letter-spaced labels, eyebrows or kickers above titles.
- **Don't** use drop shadows on resting cards, borders heavier than 1px, or hard offset shadows.
- **Don't** use band green, amber or red for anything but score meaning, and don't use Selected Green as an action fill.
- **Don't** add new `--li-*` legacy tokens or build on them; they survive only as inline fallbacks.
