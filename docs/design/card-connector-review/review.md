# Cards and alternatives to connectors

Reviewed 2 November 2026. [Interactive visual board](index.html) · [Close-up comparison](comparison.webp).

## Recommendation

The strongest new direction is **docked annotations**: keep the human conversation as the main translucent surface, but let each insight meet its outer edge near the relevant highlighted phrase. The attachment is expressed by proximity, overlap and a small matching colour edge rather than a long line. It feels closer to a carefully designed marginal annotation than a workflow editor.

If exact phrase-to-note traceability remains the priority, the **refined-thread** version is the safest evolution. Keep the natural routing, but reduce the terminal size and halo and sharpen the card material. A thicker connector is not automatically more polished; it must remain subordinate to the evidence and readable analysis.

These are design judgments based on visual comparisons. There is no conversion experiment establishing a winner.

## What the current treatment can improve

- Main and note surfaces have very similar translucency. Their material hierarchy is less distinct than their content hierarchy.
- Soft shadows alone can make the cards feel like blurred rectangles. A small contact shadow and a controlled edge reflection give a more precise boundary.
- Full rings and constant-colour rails make the connectors read as node-editor UI. They explain the relationship well, but introduce a technical visual vocabulary alongside an otherwise human tutoring scene.
- The notes are vertically centred on each entire voice region. That sometimes places them well above the important phrase, forcing a larger curved path.

## Material recommendations

1. Keep the main conversation surface translucent. Give text-rich notes slightly more body so the analysis feels crisp against the desk. This is a proposed contrast between surfaces, not a recommendation to make the whole hero opaque.
2. Use a fine top-edge highlight, quieter side borders and a small, sharp contact shadow plus a broader ambient shadow. The photograph's upper-left daylight should be the implied common light source.
3. Maintain the existing 14px / 10px corner hierarchy. More pill rounding or large shiny bevels would weaken the restrained presentation.
4. In dark mode, distinguish elevation with surface luminance and contour as well as shadow; a black shadow alone does little on a dark surface.
5. Let the source highlight and note arrival carry the colour. Avoid a continuously animated rainbow border or permanently glowing perimeter.

## Visual studies on our actual hero

All studies retain the existing headline, desk photograph, faces, ribbons and transcript content. They were made by temporarily changing styles and geometry in a local browser; product source was not edited.

| Study | Advantage | Trade-off |
| --- | --- | --- |
| Current | Explicit connection from exact evidence to analysis | More visual wiring and technical endpoints |
| A: refined threads | Precise materials, finer line and smaller terminal | Incremental rather than a new composition |
| B: colour-paired notes | Removes wiring while preserving current layout | Colour and speaker association are less precise than a direct connection |
| C: aligned marginal notes | Notes sit level with evidence, using proximity as well as colour | Needs dynamic positioning and collision handling for different quotations |
| D: docked annotations | Strong physical relationship; feels like part of one authored object | Must preserve text clearance, avoid covering the ribbon, and stack cleanly on mobile |
| E: soft ribbon | Echoes the existing voice-ribbon motif with a translucent band | Can look hazy and make text clearance harder; not the clearest improvement |
| F: one active insight | One larger, more readable payoff at a time | Earlier analysis disappears, reducing at-a-glance completeness |

**Preferred combination:** D's physical attachment with A's restrained material precision. Use two clear material roles, a quiet colour accent at the join, and the existing evidence sweep. Animate the annotation's arrival briefly, then let it rest. A mobile implementation would use inline/stacked annotations rather than forcing desktop docking into a narrow viewport. Keep the current accessible full transcript and reduced-motion state.

A hover or keyboard focus could strengthen the associated highlight, but the essential relationship should remain visible without hovering. For a single-active-note design, alternate the note with the speaker turns rather than requiring interaction.

## Established examples and primary guidance

### Microsoft Fluent: shadow and light

[Fluent elevation](https://fluent2.microsoft.design/elevation) explains the roles of directional and ambient shadow and a consistent perceived light source. Its rendered examples were inspected at both overview and detail scale. The borrowable idea is precise depth and a coherent shadow system, not copying a platform skin.

### Apple: materials have different roles

[Apple's material guidance](https://developer.apple.com/design/human-interface-guidelines/materials) distinguishes standard content materials from Liquid Glass used for controls/navigation. Read the primary Markdown page as well as its examples. Applied to this web hero, that argues for restrained frosted content surfaces with stable text contrast, rather than adding pronounced optical refraction or glistening glass to every card. This is an adaptation of platform guidance, not a requirement to reproduce Apple's native material.

### Atlassian: elevation in dark mode

[Atlassian elevation](https://atlassian.design/foundations/elevation/) uses surface and shadow together, including luminance differences in dark mode. The relevant implication is to give the insight a deliberate surface role in each theme. Do not assume the same translucent white rim and black shadow will work equally well in both.

### Stripe: crisp product surfaces

[Stripe Payments](https://stripe.com/gb/payments) was visually inspected live. The product surface has quiet corners, a fine internal hierarchy and restrained shadow, while the broader surrounding artwork provides most colour. Borrow the separation between a readable surface and expressive surroundings. The screenshot retains a small cookie notice outside the main product example.

### Attio: quiet framing

[Attio](https://attio.com/) was visually inspected live. Its first-fold product preview uses fine neutral boundaries and an understated surrounding surface. Borrow the confidence of quiet framing. A deeper screenshot omitted part of the animated preview, so the first-fold screenshot is the reference used in the board.

### React Flow: clear attachment vocabulary

[React Flow Turbo Flow](https://reactflow.dev/examples/styling/turbo-flow) was visually inspected live. Its smooth connections and distinct ports make graph relationships explicit. It is useful evidence for why our rings currently read as a technical workflow. Borrow attachment clarity; leave behind the neon perimeter and node-editor iconography.

### tldraw and Carbon: relationship clarity

[tldraw arrow binding options](https://tldraw.dev/examples/arrow-binding-options) provide an implementation reference for geometry that follows attached shapes. [Carbon flow charts](https://www.carbondesignsystem.com/building-blocks/data-visualization/flow-charts) were read and visited for diagram conventions. Neither establishes that diagrams are the best metaphor for a tutoring hero. The useful principle is that spatial relationships and routing should express a real relationship, rather than decorate an arbitrary gap. Carbon's network section capture did not include a full rendered network example, so it is not presented as primary visual evidence.

## Limits and next concrete step

Seven light-mode desktop explorations were captured at 1440 × 1000. These static studies show composition and material differences, not completed animation or responsive behavior. A real docked implementation needs measurement of the nearest highlighted fragment, text/ribbon avoidance, note-to-note spacing, stable exit motion and mobile fallbacks. The controls were given extra clearance in the explorations so lower notes do not cover them.

The next useful implementation is the docked variant behind a presentation flag, compared with refined threads in both themes and at phone/tablet widths. No additional libraries, rendering framework, image generation or permanent source changes were needed for this research.
