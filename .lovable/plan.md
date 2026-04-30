## Pass 9: Content & Messaging Updates

Content-only updates across the marketing site to refine messaging, reorganize Services, expand About, and remove unverifiable claims.

---

### Homepage (`src/components/sections/HeroSection.tsx`, `WhyDifferentSection.tsx`, `Footer.tsx`, `Index.tsx`)

- Change badge **"Fear Free Certified" → "Fear Free Trained"** in the hero pill row.
- Replace the "Locally Owned" pill with **"Independent · Female-Owned"** (keeps three pills: Fear Free Trained · Independent · Female-Owned · Boulder, CO — actually four; we'll keep Boulder pill).
- Add a short line under the hero subhead: *"An independent, female-owned private practice in Boulder."*
- In `WhyDifferentSection`, change the **"Fear Free Certified"** card to **"Fear Free Trained"** with updated description (team trained in Fear Free handling methods).
- Update `Footer.tsx` tagline: "Fear Free certified veterinary care" → "Fear Free trained veterinary care".
- Update `Index.tsx` page title: "Fear-Free Veterinary Care in Boulder" → "Fear Free Trained Veterinary Care in Boulder".

### The Experience (`src/components/sections/experience/HowItWorks.tsx`, `WhyItMatters.tsx`)

- In `HowItWorks`, **add a new Step 04: "Stay With Your Pet"** — "You're welcome to stay through the entire appointment. No back-room exams, no separation anxiety. We work alongside you so you can ask questions and your pet has their person right there."
- Renumber existing Step 04 ("Experience Fear Free Care") → Step 05, and update title to **"Experience Fear Free Trained Care"** with matching description tweak.
- In `WhyItMatters` "Living Room Experience" card, **remove the "Relaxed from start to finish" bullet** and replace it with **"You stay with your pet the whole visit"**.

### Services (`src/pages/Services.tsx`, `src/components/sections/ServicesSection.tsx`)

Reorder the featured/listed services to: **Wellness Care → Senior Care → Illness Care → Diagnostics → Surgery → Laser Therapy**. (Dentistry intentionally excluded per your confirmation; Vaccinations stays in the "More Services" grid.)

- Create new page `src/pages/services/IllnessCare.tsx` for sick visits / acute concerns / treatment workups, modeled on existing `ServiceDetailLayout` pages. Add route to `src/App.tsx` at `/services/illness-care` (wrapped in `MarketingErrorBoundary`).
- Update both `Services.tsx` (full page) and `ServicesSection.tsx` (homepage section) arrays to match the new order. Add Illness Care entry with the `Stethoscope` icon (and reassign Diagnostics to a different appropriate icon to avoid duplicates — e.g., `FlaskConical`).
- Update `src/pages/Services.tsx` hero subcopy "delivered with Fear Free certified care" → "delivered with Fear Free trained care".

### About (`src/pages/About.tsx`)

- **Replace the second hero paragraph** with: *"Located in Boulder, Colorado, we're an independently owned practice that has reimagined every detail of veterinary care around one goal: making trips to the vet much less stressful."*
- **Rewrite the "Our Story" section** using your provided copy verbatim (Dr. Susan Edler instead of Dr. Sarah Mitchell; new closing paragraph including "Appointments structured to give owners time to ask questions"). Update the "they wanted it to feel like home" italic line to **"they wanted it to feel less stressful."**
- In Values, change **"Fear Free Always" → "Low Stress Handling"** (description: "We're trained in low-stress handling techniques that minimize fear and anxiety from the moment your pet arrives.").
- **Remove the entire "Certifications & Training" section** (the two-card block) including its imports/data.
- In the team data, change every **"Fear Free Certified" → "Fear Free Trained"** credential.
- **Add a new "Payment Options & Our Philosophy" section** on About (placed after Team, where Certifications used to be) with two cards:
  - **Payment Options**: "We accept credit card, cash, Scratchpay (including Scratchpay Payment Plans), and Cherry."
  - **Our Philosophy**: "We value transparency. Recommended treatment plans come with written estimates and tiered options — Essential, Recommended, and Comprehensive — so you can make informed decisions for your pet and your budget."

> Note: Defaulting Payment Options to a new section on About since you didn't pick a placement — easy to move to a standalone page later if preferred.

### Other Fear-Free → Fear Free Trained cleanup

Update remaining marketing copy mentions to "Fear Free trained" (not "certified"):
- `src/pages/services/Diagnostics.tsx` (1 mention)
- `src/pages/services/Vaccinations.tsx` (2 mentions)
- `src/pages/services/Surgery.tsx` (1 mention)
- `src/components/layout/ServiceDetailLayout.tsx` (CTA copy)

Leave "Fear Free" (the program/methodology name) intact — only the *certification* claim is being softened to *trained*.

---

### Files Created
- `src/pages/services/IllnessCare.tsx`

### Files Edited
- `src/App.tsx` (add Illness Care route)
- `src/pages/Index.tsx`
- `src/pages/About.tsx`
- `src/pages/Services.tsx`
- `src/pages/services/Diagnostics.tsx`, `Vaccinations.tsx`, `Surgery.tsx`
- `src/components/sections/HeroSection.tsx`
- `src/components/sections/WhyDifferentSection.tsx`
- `src/components/sections/ServicesSection.tsx`
- `src/components/sections/experience/HowItWorks.tsx`
- `src/components/sections/experience/WhyItMatters.tsx`
- `src/components/layout/Footer.tsx`
- `src/components/layout/ServiceDetailLayout.tsx`

No database, auth, or backend changes.