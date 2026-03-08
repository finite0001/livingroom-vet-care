

## Site Evaluation: Issues and Improvements

After reviewing the entire codebase top to bottom, here are the findings organized by category.

---

### Bugs to Fix

1. **App.css conflicts with layout** — The default Vite `App.css` file sets `#root { max-width: 1280px; margin: 0 auto; padding: 2rem; text-align: center; }`, which constrains the entire app to 1280px with padding and centered text. This is leftover boilerplate that likely interferes with the full-width header, hero sections, and footer. Should be deleted or emptied.

2. **Broken service links on homepage** — The Services section on the homepage links to `/services/urgent-care` and `/services/dental`, which are routes that don't exist (no pages created). These will 404.

3. **Contact page driving directions still reference Pearl Street** — The "Getting Here" directions card (lines 438-465) still says "turn left on Pearl Street" and references "Pearl Street" parking, despite the address being updated to Spruce Street.

4. **Contact page Quick Links use `<a>` instead of `<Link>`** — The Quick Links card (line 374-380) uses raw `<a href>` tags for internal routes, which causes full page reloads instead of client-side navigation.

---

### UX/UI Improvements

5. **Homepage services section is stale** — Lists "Urgent Care" and "Dental Care" as services, but these pages don't exist. Should be updated to show Vaccinations and Surgery instead, matching the actual available service pages.

6. **"Book Appointment" / "Take a Virtual Tour" buttons are non-functional** — Multiple CTA buttons across the site (hero, header, service pages) don't navigate anywhere. At minimum, "Book Appointment" should link to the Contact page, and "Take a Virtual Tour" should link to `/experience`.

7. **Missing Vaccinations from Services page featured list** — The Services page (`/services`) doesn't include Vaccinations in its featured services section despite having a full detail page.

8. **No scroll-to-top on navigation** — When navigating between pages via React Router, the scroll position isn't reset. Users land mid-page on the new route.

---

### Plan

**Step 1: Delete App.css boilerplate**
Remove the conflicting Vite default styles from `App.css` and its import from `main.tsx` (if imported).

**Step 2: Fix homepage ServicesSection**
Replace "Urgent Care" (`/services/urgent-care`) and "Dental Care" (`/services/dental`) with "Vaccinations" (`/services/vaccinations`) and "Surgery" (`/services/surgery`), matching actual routes.

**Step 3: Fix Contact page direction references**
Update the three driving direction paragraphs to reference Spruce Street instead of Pearl Street.

**Step 4: Fix Contact page Quick Links**
Change `<a href>` to React Router `<Link to>` for internal navigation links.

**Step 5: Wire up CTA buttons**
- Header "Book Appointment" → link to `/contact`
- Hero "Book Appointment" → link to `/contact`
- Hero "Take a Virtual Tour" → link to `/experience`
- ServiceDetailLayout "Book This Service" / "Ask a Question" → link to `/contact`

**Step 6: Add scroll-to-top on route change**
Create a small `ScrollToTop` component using `useLocation` that scrolls to top on pathname change, placed inside `BrowserRouter` in `App.tsx`.

**Step 7: Add Vaccinations to Services page**
Add Vaccinations (with its image) to the `additionalServices` or `featuredServices` array on the Services page so it's discoverable.

