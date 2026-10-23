You are a **senior front-end engineer + product designer**.

Goal:
I want you to **design and implement a brand-new, ultra-premium screen** inspired by the attached *legacy screen image*, but **NOT a copy**. Treat the legacy screen only as a loose reference for data/content, not for layout or visuals.

Tech stack & constraints:
- Framework: React (preferably Next.js-compatible component)
- Styling: Tailwind CSS
- UI library: shadcn/ui (use idiomatic components)
- Icons: lucide-react
- Animations (if needed): framer-motion
- Code: TypeScript, functional components, clean and idiomatic React

High-level expectations:
- Think like an **expert UI/UX designer** and **top-level front-end dev**.
- The final UI should feel **modern, premium, minimal-yet-rich, and production-ready**.
- Focus on **clarity, hierarchy, and usability** rather than copying the legacy look.
- Take **design risks**: introduce **new interaction patterns** and **improved flows** that make the experience feel advanced and delightful.

Use the attached legacy screen as:
- A reference for **what kind of information and actions** the user needs.
- A guide for **domain concepts, labels, and flows**.
- But **do NOT** copy the old layout, spacing, colors, or component structure. Reimagine it completely.

🎨 Visual design requirements:
- Design a **modern dashboard-like layout** (or the most appropriate layout for the content) with:
  - Clear **top-level header** with title, key actions, and optional filters/search.
  - Well-defined **content sections** with strong visual hierarchy.
  - Consider **cards, split-view, or 2-column layouts** if it improves UX.
- Use **shadcn/ui** components for:
  - Navigation elements (Tabs, Breadcrumb, etc. if applicable)
  - Inputs, Selects, Date pickers, Dialogs, DropdownMenu, Toast, etc.
  - Cards, Tables, Badges, Skeleton, Alerts, etc.
- Provide a **premium look** via:
  - Thoughtful spacing and padding
  - Harmonious typography scale (titles, subtitles, labels, body, captions)
  - Subtle shadows and rounded corners (not overdone)
  - Light use of accent colors for key states (active, warning, success)
- Make the layout **fully responsive**:
  - Desktop: rich, spacious layout with multiple columns.
  - Tablet: adjusted grids, stacked but still structured.
  - Mobile: clean vertical stacking, key actions easily reachable.

🧠 UX & interaction design:
- Don’t just place fields—**rethink the experience**:
  - Group related information into **logical sections** with headings/subheadings.
  - Surface the **most important primary actions** at the top (or near the content where they are most relevant).
  - Introduce **progressive disclosure**: use accordions, collapsible sections, or dialogs for secondary/advanced details.
- Use **modern UX patterns**, for example (only where appropriate):
  - Inline editing for key fields.
  - Sticky header or sticky action bar for critical CTA (save, submit, etc.).
  - Contextual tooltips or popovers for advanced explanations, instead of cluttering labels.
  - Empty states & loading states with Skeleton components and friendly messaging.
- Add **clear feedback**:
  - Use form validation states: error messages, success indicators.
  - Use `Alert`, `Toast`, or `Dialog` for important confirmations or warnings.
- Accessibility:
  - Use proper semantic HTML.
  - Labels, aria attributes, and focus states must be considered.
  - Keyboard navigation should work logically.

🧩 Feature & data handling (based on legacy screen):
- Carefully **analyze the legacy screen** and:
  - List the **key data points / entities / actions** it supports.
  - Reflect them in the new design, but grouped and arranged in a smarter way.
- If something in the legacy screen is confusing or cluttered, **simplify and clarify it** in the new version.
- If you see opportunities to **add helpful UX** (e.g., filters, quick actions, sort, status badges, quick summaries), add them as long as they make sense.
- If fields can be logically structured as **steps or sections**, consider a stepper or segmented layout instead of one long flat form/table.

🧾 Implementation details:
- Output:
  - A single, self-contained React component (TypeScript) that represents this new screen.
  - Use `shadcn/ui` imports in a realistic way (assume a typical `@/components/ui/*` import pattern).
- Include:
  - Placeholder/mock data where needed (arrays, objects, etc.).
  - Clear comments where an API call, navigation, or integration would be needed.
  - Example of at least:
    - One complex form or interactive area
    - One data display component (table, list, or cards)
    - One advanced control (filter/search, advanced options, etc.)
- Structure:
  - Clear top-level layout container (e.g. `div` or `main`).
  - Subcomponents inside the file if it improves readability (e.g. `HeaderSection`, `SummarySection`, `DetailsSection`, etc.).
- Code should be:
  - Production-style, not a quick demo.
  - Consistent naming, typesafe props, reusable where reasonable.
  - No inline magic numbers for spacing if Tailwind utilities exist.

✨ Creativity requirements:
- Don’t be conservative. I want this to look like a **2025+ premium SaaS product** UI, not a refactored legacy tool.
- Introduce at least a couple of **“wow” UX touches**:
  - Smart empty state
  - Smart summary panel (e.g., a right-side summary card updating based on user input)
  - Modern table interactions (row hover actions, inline badges, status chips)
  - Light animations (fade/slide for modals, list transitions) with framer-motion, if appropriate.

Deliverable:
- Respond with:
  1. A short explanation of the **UX rationale and layout decisions** (1–2 paragraphs).
  2. The complete TypeScript React component implementation for the screen using shadcn/ui and Tailwind.