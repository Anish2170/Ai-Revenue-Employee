# Business Actions Walkthrough

## Goal

Business-critical popup actions are now separated into two responsibilities:

- The AI decides which configured action ID best matches the visitor context.
- The business configures how that action works: label, destination type, and destination.

The AI must not generate URLs, phone numbers, email addresses, WhatsApp numbers, or CTA labels for newly generated popups. All destinations come from onboarding/dashboard configuration.

## Business Configuration

A new Business Actions system was added for each website.

Starter actions are seeded as optional disabled rows:

- `book_demo` - Book Demo
- `contact_sales` - Contact Sales
- `pricing` - View Pricing
- `learn_more` - Learn More
- `start_free_trial` - Start Free Trial
- `whatsapp` - WhatsApp
- `call_now` - Call Now
- `contact_support` - Contact Support

Businesses can enable only the actions they need and configure:

- Internal Action ID
- Display Label
- Destination Type
- Destination
- Enabled state

Custom actions are supported through the same API and dashboard flow, for example `schedule_site_visit`.

Supported destination types are:

- `URL`
- `CHAT`
- `WHATSAPP`
- `PHONE`
- `EMAIL`

The destination validation is centralized so more destination types can be added later.

Key files:

- `backend/src/business-actions/action.types.ts`
- `backend/src/business-actions/action.service.ts`
- `backend/src/business-actions/action.routes.ts`
- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260709162000_add_business_actions/migration.sql`

## Dashboard

A new dashboard page was added at `/business-actions`.

It displays:

- Action ID
- Display Label
- Enabled
- Destination Type
- Destination
- Usage Count
- CTR
- Last Used

It also supports adding unlimited custom actions.

Key files:

- `dashboard/src/app/(dashboard)/business-actions/page.tsx`
- `dashboard/src/app/(dashboard)/layout.tsx`
- `dashboard/src/lib/api.ts`

## Tenant Context

The tenant resolver now loads enabled executable Business Actions for the website and attaches them to the tenant context.

Only enabled actions with valid destinations are exposed to AI prompt construction.

Important behavior:

- Disabled actions are not sent to Gemini.
- Actions with missing or invalid destinations are not sent to Gemini.
- Tenant cache is invalidated when actions change.

Key files:

- `backend/src/tenant/tenant.resolver.ts`
- `backend/src/context/types.ts`
- `backend/src/context/provider.ts`

## AI Prompt Contract

Popup generation prompts now include only action IDs and labels.

Example prompt context:

```text
Available Actions (choose only these Action IDs; never invent action IDs, URLs, phone numbers, email addresses, or WhatsApp numbers):
- book_demo: Book Demo
- pricing: Pricing
```

Destinations are intentionally not included in the AI prompt.

The popup schema now uses structured actions:

```json
{
  "title": "...",
  "body": "...",
  "primaryAction": "book_demo",
  "secondaryAction": "pricing",
  "tone": "reassuring",
  "popupType": "pricing"
}
```

The schema and prompt explicitly forbid:

- `cta`
- `ctaLabel`
- `ctaUrl`
- `destination`
- raw events
- debug/reasoning fields

Key files:

- `backend/src/prompts/shared.ts`
- `backend/src/prompts/popupPromptBuilder.ts`
- `backend/src/prompts/engagePromptBuilder.ts`
- `backend/src/validation/popupSchema.ts`
- `backend/src/validation/engageSchema.ts`

## Response Validation

The popup response validator now rejects any newly generated popup that contains AI-generated CTA labels or destinations.

It accepts `primaryAction` and `secondaryAction` only when the IDs match enabled configured actions for the current business.

If Gemini invents an action ID, the popup is suppressed.

If Gemini outputs a URL, destination, or CTA label, the popup is suppressed.

Key file:

- `backend/src/intelligence/responseValidation.ts`

## Popup Delivery

When `/events` generates a safe popup, the backend resolves the selected action ID back to the business-owned action configuration before sending it to the widget.

The public popup payload can include:

- `primaryAction`
- `secondaryAction`
- resolved `action`
- resolved `secondaryActionConfig`

The widget receives the resolved configuration and renders labels from onboarding data only.

Key file:

- `backend/src/routes/events.ts`

## Widget Runtime

The widget now renders CTA buttons only from resolved Business Action configuration.

On click:

- `CHAT` opens the chat.
- `PHONE` normalizes to `tel:` when needed.
- `EMAIL` normalizes to `mailto:` when needed.
- `URL` and `WHATSAPP` navigate only to configured destinations.

If an action is missing, disabled, invalid, or not resolved, the CTA is hidden gracefully. The widget does not invent a fallback destination.

Legacy `ctaUrl` is still supported temporarily for old popups.

Key files:

- `widget/src/types.ts`
- `widget/src/sensors/index.ts`
- `widget/src/popup/popup.ts`
- `widget/src/core/orchestrator.ts`
- `widget/src/ui/styles.ts`

## Analytics

Analytics now records stable Action IDs instead of relying on button labels.

Examples:

- `popup_displayed` with `actionId: "book_demo"`
- `popup_clicked` with `actionId: "book_demo"`
- `book_demo_clicked`

The AI decision log also stores `ctaActionId` and the dashboard displays it.

Key files:

- `backend/src/analytics/analytics.service.ts`
- `backend/src/analytics/decision-log.service.ts`
- `backend/src/analytics/analytics.routes.ts`
- `dashboard/src/components/analytics-view.tsx`
- `widget/src/analytics/analytics.ts`
- `widget/src/core/orchestrator.ts`

## Backward Compatibility

Existing legacy popups with `ctaUrl` still work temporarily.

New popup generation no longer accepts free-form CTA labels or URLs. New popups use `primaryAction` and `secondaryAction` only.

This preserves existing behavior while preventing future AI-generated business links.

## Safety Guarantees

The final safety boundary is:

1. Business configures actions and destinations.
2. Tenant resolver loads only enabled executable actions.
3. Prompt gives Gemini only action IDs and labels.
4. Response validation rejects invented action IDs and all destination fields.
5. Backend resolves action IDs to business-owned configuration.
6. Widget executes only resolved configured destinations.
7. Analytics records stable Action IDs.

This makes the business the single source of truth for labels and destinations.

## Tests and Verification

Added or updated tests for:

- Prompt includes action IDs/labels but never destinations.
- Popup schema uses `primaryAction` and `secondaryAction`.
- Response validation accepts enabled configured action IDs.
- Response validation accepts custom action IDs.
- Response validation rejects missing or disabled action IDs.
- Response validation rejects AI-generated CTA labels and URLs.
- Popup generation no longer depends on legacy `cta`.

Verification run:

- `backend`: `npm run typecheck` passed.
- `backend`: targeted tests passed, 69/69.
- `backend`: `npm run build` passed.
- `widget`: `npm run typecheck` passed.
- `widget`: `npm run build` passed.
- `dashboard`: `npm run build` passed.

Known note:

- `dashboard npm run lint` still reports existing React hook lint issues unrelated to Business Actions.

## Result

The platform now supports scalable Business Actions where every business can use different labels and destinations while the AI behavior stays consistent and safe.

The AI chooses what should happen.

The business controls how it happens.
