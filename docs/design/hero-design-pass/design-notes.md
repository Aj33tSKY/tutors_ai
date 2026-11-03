# A luminous conversation, in a human setting

Implemented 2 November 2026. [Visual comparison board](index.html) · [Before / after](before-after.webp).

## Direction and visual language

The learning exchange remains the hero object. Real participant photographs and Newsreader quotations distinguish human speech from the Geist interface and analysis. The scene stays grounded in a study desk, with a quieter crop and directional daylight instead of extra abstract effects.

The selected desktop composition deliberately bridges the white/photo boundary. Wider insight cards and a shorter conversation panel bring the evidence and its interpretation into a single reading path. A second, more inset composition was captured for comparison; it narrowed the conversation and wrapped highlights more, so the wider version remains active.

### Colour roles

| Role | Value | Use |
| --- | --- | --- |
| White | `#ffffff` | Page and clear light surfaces |
| Ink | `#252a28` | Main conversation text |
| Graphite | `#4a514e` | Supporting analysis |
| Kindling green | `#58cc02` | Existing CTA, tutor ribbon and tutor evidence |
| Student violet | `#9773dc` | Student ribbon, evidence and connector in light mode |
| Soft violet | `#b8a0f4` | Student voice in dark mode |

Dark mode retains the application's existing dark background and uses `#f7f7f3` for primary conversation text. Surfaces remain neutral and translucent. Warmth comes from the photographic wood/paper; there is no green surface wash or photo fade. Saturated colour communicates the two voices and the important evidence.

### Changes

- Quieter, purpose-made desk photograph. Laptop removed; writing hand and paper occupy the lower outer edge.
- Wider note column and 14px analysis text. Existing meaningful opening phrases receive inline emphasis across all 32 scenarios; no additional headings or claims were introduced.
- Reduced excess vertical space in the conversation and refined desktop proportions.
- Full-sentence measurement reserves caption space while whole words arrive, preventing typing-induced shifts.
- Ribbons retain the same measured speech and smooth geometry. A stronger central filament, varied line weights, very light surface fill and local edge illumination add material depth. Outer contour points are reused for the fill.
- Evidence appears first, connector motion begins shortly after, and the note resolves 400ms after evidence becomes ready. The original speech speed is unchanged.
- A small, static green/violet ribbon signature echoes the demo at the transition into the rest of the page.
- Notes stack below the conversation through 640px, keeping intermediate phone/tablet widths readable.

## Research and guidance

The [earlier visual review](../hero-fresh-review/review.md) inspected seven technology/AI heroes at matching desktop viewports. This pass broadened the references:

- [Aesop](https://www.aesop.co.uk/): visually inspected a live campaign hero. Human scenes, material texture and quiet controls informed the photographic treatment; its ecommerce navigation was not adopted.
- [Aman](https://www.aman.com/): visually inspected its filmed hero and spacious framing. Applied the principle of letting the scene establish atmosphere while the interface remains restrained.
- [Pentagram / Imperial](https://www.pentagram.com/work/imperial): inspected the identity case study and its visual treatment. The useful lesson is a repeatable visual language across colour, typography and a signature form; ours uses the voice ribbon rather than borrowing its letterforms.
- [Bang & Olufsen](https://www.bang-olufsen.com/en/gb): visited for materials/lighting research. Its cookie overlay prevented a clean hero capture, so it is not used as primary visual evidence.
- [NN/g: five principles of visual design](https://www.nngroup.com/articles/principles-visual-design/): used scale, hierarchy, contrast and balance to prioritise the conversation and its payoff. The larger notes address an actual readability weakness.
- [Apple: motion](https://developer.apple.com/design/human-interface-guidelines/motion): used brief, purposeful feedback and retained reduced-motion behavior and pause/replay controls.
- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): read as an external design reference. Applied subject-specific materials, compact colour/type roles, one memorable element and screenshot critique. No external plugin or dependency was installed. Existing user choices take priority over general style preferences.

## Verification and limits

TypeScript (`npx tsc --noEmit`) and whitespace checks (`git diff --check`) pass. Browser viewport checks at 320, 390, 480, 600, 640, 768, 1024, 1100 and 1440px found no horizontal overflow; notes computed to 14px. Light, dark, reduced-motion and mobile screenshots were inspected. A live run sampled 100 frames/states over about 18 seconds, including a scenario change; 72 visible connector checks confirmed source attachment to a highlight edge and destination attachment to the note. Whole-word samples and browser exceptions are recorded in [motion-checks.json](motion-checks.json); no exceptions were observed.

This verifies the sampled browser layouts and animation states, not every possible scenario/viewport combination or conversion performance. The screenshots use reduced motion to compare completed compositions. Reference screenshots are research artifacts, not assets served by the public site.

## New photograph and rollback

The new illustrative photo is [study-desk-editorial.webp](../../../public/images/marketing/study-desk-editorial.webp), generated with the built-in imagegen tool and optimized to WebP. The full prompt and source location are recorded in [marketing-image-sources.md](../marketing-image-sources.md#study-desk-editorial).

The original desk asset remains available. Change the `full-bleed` entry in `HERO_PHOTOS` back to `/images/marketing/study-desk.webp` to compare the previous photo. The `framed` and `human` photo treatments and the existing floating/inside/photo-profile feature flags remain available. The board preserves the previous visual state; this pass is local and uncommitted.
