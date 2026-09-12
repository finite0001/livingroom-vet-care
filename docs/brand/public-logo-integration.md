# Public logo integration — review candidate v1

**Final owner approval pending. This raster is not a production vector master.**

The public header and footer now use one reusable `src/components/Logo.tsx` component: the approved armchair/dog/cat direction with medical cross, paired with live text **The Living Room** / **Veterinary Care**. The existing site fonts and semantic color tokens are retained. Both logo links have the accessible name “The Living Room Veterinary Care — home”; the image is decorative alongside that name. The footer uses a cream backing to keep the dark cat legible against its charcoal background.

## Responsive previews

These are browser screenshots of the real public site at this branch, not redesigned mockups:

- [320 px mobile header](header-320.png)
- [390 px mobile header](header-390.png) and [footer](footer-390.png)
- [1024 px header](header-1024.png)
- [1440 px header](header-1440.png) and [footer](footer-1440.png)

The mark displays at 48 CSS px on small screens and 56 CSS px from the existing `md` breakpoint. The medical cross is small at these sizes; the readable Veterinary Care descriptor supplies the medical meaning without relying on tiny icon detail. Browser checks found no horizontal overflow at 320, 390, 1024 or 1440 px. Header/footer home links and the mobile menu Contact path were exercised without submitting a form.

## Asset provenance and limitations

`public/brand/living-room-medical-mark-v1.png` is an unchanged copy of the supplied generated icon `exec-a1b14144-895e-4c38-9f01-d0627529198d.png` from generation `01a09625-9313-71f2-81f3-d3f8920a2781`. The broader medical wordmark reference remains in the separate brand worktree at `docs/brand/living-room-logo-medical-v3.png`; its baked-in lettering is not used on the website.

Browser canvas inspection verified a 1254 × 1254 RGBA image with all four corner alpha values zero: 886,179 fully transparent pixels, 684,449 partially transparent pixels and 1,888 fully opaque pixels. Transparency is genuine, but partial alpha, texture and edge fringe remain. No image pixels were edited, recolored or automatically traced. The supplied PNG is about 649 KiB; it is oversized for a final header asset and should be replaced with an owner-approved optimized/vector master before brand commissioning. This review does not claim suitability for signage, embroidery, monochrome reproduction or favicon sizes.

At the displayed header/footer sizes, the texture and fringe are not conspicuous enough to prevent reviewing this candidate in context. Retain final review of animal silhouettes, medical cross clarity, small-size readability, print colors and a clean vector master. Do not label this file a completed production brand system.

No global typography/colors, intake behavior, contact fields, launch statements, booking paths or provider settings were changed.
