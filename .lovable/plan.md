

## Cleanup, Visual Polish, and ADA/Accessibility Compliance

After reviewing the full codebase, here are the issues organized by category:

---

### 1. ADA / Accessibility (WCAG 2.1 AA) Issues

**Critical:**
- **`index.html` — Missing proper title and description.** Still says "Lovable App" and "Lovable Generated Project". Screen readers and search engines use this. Must update to "The Living Room Vet — Fear Free Veterinary Care in Boulder, CO".
- **Missing skip navigation link.** WCAG requires a "Skip to main content" link for keyboard users at the top of every page. Neither the marketing site nor the hub has one.
- **Missing `aria-label` on the scroll indicator** in `HeroSection` (the bouncing mouse/scroll element). Screen readers announce nothing for this decorative element — it needs `aria-hidden="true"`.
- **Missing `aria-current="page"` on active nav links** in `Header.tsx`. Screen readers can't distinguish the current page from other links.
- **Missing `role="navigation"` and `aria-label` on footer nav sections.** The footer has two `<nav>` elements with no labels — screen readers can't distinguish them. Need `aria-label="Quick links"` and `aria-label="Services"`.
- **Form error messages not linked to inputs via `aria-describedby`** in `Contact.tsx`. When validation errors show, screen readers don't announce them. Each error `<p>` needs an `id` and the corresponding input needs `aria-describedby` and `aria-invalid`.
- **Color contrast on muted text over cream backgrounds.** The `text-muted-foreground` (HSL 0 0% 40%) on `bg-cream` (HSL 40 33% 94%) yields approximately 3.8:1 — below the 4.5:1 AA minimum for normal text. Need to darken muted-foreground to ~33% lightness.
- **Hub login page**: The "LRV" logo `<span>` inside a div has no alt text or aria-label. Should have `role="img" aria-label="The Living Room Vet logo"`.
- **Missing `<main>` landmark `id="main-content"`** for skip-nav target.

**Moderate:**
- **No focus-visible styles on custom interactive elements** like the badge pills in HeroSection, stat buttons in HubHomePage, and quick action buttons. They rely on browser defaults which are often invisible on custom backgrounds.
- **Mobile menu lacks focus trapping.** When the hamburger menu opens, keyboard users can tab behind it into the page content.
- **Google Maps iframe** in Contact page needs `aria-label` (already has `title`, which is good).

### 2. SEO / Meta Fixes

- **`index.html`**: Update `<title>`, `og:title`, `og:description`, `meta description`, and remove the Lovable opengraph image reference.
- **Per-page titles**: No pages set `document.title`. Each page should set it (e.g., "Services — The Living Room Vet").

### 3. Code Cleanup

- **Unused CSS import**: `src/App.css` is empty. Can be deleted (check if it's imported in `main.tsx`).
- **`Scissors` import unused**: In `Services.tsx`, `Scissors` is imported but `Stethoscope` is used for Surgery. The Surgery service uses `Scissors` — wait, checking... actually Surgery uses `Stethoscope` in the `featuredServices` array but the dedicated Surgery page likely uses its own icon. The import is used on line 8 but assigned to Surgery on line 39. This is fine.
- **Dead conditional logic**: `Services.tsx` line 110-111 has `${index % 2 === 1 ? "" : ""}` — does nothing, can be removed.
- **Privacy Policy and Terms** in footer are plain `<span>` elements, not links. They should either be links to actual pages or be removed.

### 4. Visual Improvements

- **NotFound page** is bare-bones (no Header/Footer, no branding). Should match the marketing site's look and feel.
- **Hub `PlaceholderPage`** — should show which feature is "coming soon" based on the current route, rather than a generic message.

---

### Implementation Plan

**Step 1 — ADA: Skip nav, landmarks, aria attributes**
- Add a visually-hidden "Skip to main content" link in `Header.tsx` and hub `AppShell.tsx`
- Add `id="main-content"` to `<main>` elements across all page templates
- Add `aria-current="page"` to active nav links in `Header.tsx`
- Add `aria-label` to footer `<nav>` elements
- Add `aria-hidden="true"` to decorative elements (scroll indicator, decorative blurs)
- Add `role="img" aria-label` to the hub login logo

**Step 2 — ADA: Form accessibility in Contact.tsx**
- Add `aria-describedby` linking each input to its error message
- Add `aria-invalid` when validation fails
- Give each error `<p>` a unique `id`

**Step 3 — ADA: Color contrast fix**
- Darken `--muted-foreground` from `0 0% 40%` to `0 0% 33%` in `index.css` to achieve 4.5:1+ contrast on cream backgrounds

**Step 4 — SEO: index.html meta tags**
- Update title, description, og tags to "The Living Room Vet" branding
- Remove Lovable references

**Step 5 — Code cleanup**
- Remove empty `App.css` (and its import if any)
- Remove dead conditional in `Services.tsx`
- Make footer Privacy/Terms into actual links or placeholder pages

**Step 6 — Visual: NotFound page**
- Add Header/Footer and proper branding to the 404 page

**Step 7 — Visual: PlaceholderPage route awareness**
- Show the feature name based on current URL path

