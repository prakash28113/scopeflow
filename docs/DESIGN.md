# ScopeFlow design system

One visual language for the whole app. The tokens are in `src/styles.css` (`@theme`), and the components are in `src/components/ui.tsx` (plus `form-bits.tsx` for confirmations).

## Principles

- **Cobalt means "act here" or "you are here".** Use it for the one primary action on a screen, and for the active navigation item. Everything else is neutral.
- **Panels group lists, tables and forms.** Plain sections are separated by headings and space, not by more boxes.
- **Never use colour alone.** Every status badge has a dot plus a word, and reminders show their urgency in words ("Overdue", "Follow up", "Coming up").
- **Show real data only.** Charts show recorded payments and real project counts, never decoration.
- **One layout:** a charcoal sidebar on desktop (≥1024 px), and a compact top bar with a drawer on phones and tablets. There is no bottom tab bar, and nothing fixed covers the content.

## Colour tokens

| Token | Value | Use |
|---|---|---|
| `canvas` | #F4F5F7 | Page background |
| `surface` | #FFFFFF | Panels, tables, forms |
| `sunken` | #F0F2F5 | Hovers, wells, inactive segments |
| `line` / `line-strong` | #E4E7EC / #D0D5DD | Dividers / control borders |
| `ink` / `ink-2` / `muted` / `subtle` | #101828 / #344054 / #667085 / #98A2B3 | Text, from most to least important |
| `accent` (+ `-hover`, `-soft`, `-line`) | #005DD4 | Logo cobalt: primary actions, active state |
| `positive` / `warning` / `danger` / `info` (+ `-soft`) | #067647 / #B54708 / #B42318 / #005DD4 | Status text; the soft versions are backgrounds |
| `chrome` (+ `-2`, `-line`, `-text`, `-muted`) | #14171D | Logo charcoal: sidebar and drawer |

## Type

- **Display:** Bricolage Grotesque, via the `display` utility. Used for page titles (28–32 px) and key money figures (20–28 px).
- **Text:** Inter.
  - Section headings: 15 px, semibold.
  - Panel headings: 14 px, semibold.
  - Body: 14 px.
  - Supporting text: 13 px, muted.
  - Labels: 12–13 px, medium.
- **Money and dates** always use tabular figures (`num`).
- No all-caps labels in the app. Printed documents keep their conventional headings, such as "Tax invoice".

## Components

| Component | Notes |
|---|---|
| `Button`, `LinkButton` | primary · secondary · ghost · danger; sm (32 px) and md (36 px) |
| `Input`, `Select`, `Textarea`, `Field` | 40 px controls; errors show an icon and plain words |
| `Card`, `CardHeader`, `SectionHeading`, `PageHeader` | `PageHeader` takes `eyebrow` (breadcrumb), `meta` (status and facts) and `actions` |
| `Figures`, `Figure` | Key-figure strip: 2 per row on phones, up to 4 on wide screens |
| `Badge`, `StatusBadge`, `Tag` | Soft background, a dot and a label |
| `Segmented` | Filters and tabs |
| `Meter` | Progress (payments, revision rounds) |
| `Alert` | danger · warning · info · positive, each with an icon |
| `EmptyState` | Says what will appear and how to make it happen |
| `Skeleton`, `PageSpinner` | Page-shaped loading placeholders that respect reduced motion |
| `ConfirmDialog`, `ActionButton confirm=…` | The app's single confirmation dialog for destructive actions |

## Navigation

The sidebar groups are:

- **Workspace:** Overview, Projects, Clients.
- **Work:** Quotations, Invoices, Approvals. Approvals shows a count of what's waiting.
- **Business:** Analytics, Expenses.
- **Preferences:** Settings, Plan & usage.

Notifications live in the top bar's bell. It shows an unread count, plus a red dot when something needs attention.

## Checked widths

The browser walkthrough checks every main page at 360, 390, 430 and 820 px and on desktop, and fails if anything is wider than the screen.
