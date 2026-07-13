# Intelligent Lead Capture Walkthrough

## Goal

The lead capture system makes the AI helpful first and commercial second.

The assistant must never interrupt a visitor to ask for contact details before answering their question. It answers from business knowledge first, then only asks for contact information when there is clear buying intent and a useful follow-up resource to offer.

The intended visitor experience is:

1. Visitor asks a question.
2. AI gives the complete helpful answer.
3. If the question shows buying intent, AI naturally offers extra value.
4. Visitor may share contact details or decline.
5. Only valid contact details are stored as a lead.

## Core Behavior

The chat prompt now includes an explicit context-aware Intelligent Lead Capture policy.

The AI is instructed to:

- Answer first.
- Never gate pricing, demos, details, or advice behind an email.
- Ask for contact information only after providing value.
- Ask only when the visitor shows buying intent.
- Offer a useful resource adapted to the business and question.
- Ask softly and naturally.
- Ask for phone only when a call, appointment, emergency, or consultation requires it.
- Stop asking if the visitor declines or repeatedly gives invalid details.

Intent is classified as LOW, MEDIUM, or HIGH from the full conversation.

LOW examples:

- Just curious
- Browsing casually
- Not ready
- Declined follow-up

MEDIUM examples:

- Evaluating vendors
- Comparing options
- Describing a business problem
- Asking multiple practical follow-ups

HIGH examples:

- Purchase timeline
- Company size or scale
- Enterprise requirements
- Demo or consultation request
- Implementation, migration, or integration planning

Casual or informational conversations should continue without asking for contact details.

Key file:

- `backend/src/prompts/chatPromptBuilder.ts`

## Chat Flow

Lead capture runs after the assistant response is generated and persisted.

This is important because the system preserves the core rule:

```text
Visitor asks -> assistant answers -> lead capture evaluates
```

The capture service is called only after:

- the user message has been saved,
- the assistant has streamed the answer,
- the final assistant response has been appended to the conversation.

Key file:

- `backend/src/routes/chat.ts`

## Contact Validation

The backend validates contact information before storing a lead. The intent decision is context-aware, but validation remains deterministic and unchanged.

### Email

Emails must match a real email shape with a domain and TLD.

Accepted examples:

- `john@gmail.com`
- `sarah@company.com`

Rejected examples:

- `abc`
- `test`
- `hello@gmail`
- `@gmail.com`
- `john@`
- `john@gmail`

Invalid emails are not stored.

### Phone

Phone numbers are normalized before storage.

Accepted examples:

- `+1 555 123 4567`
- `+91 9876543210`
- `9876543210`

Rejected examples:

- `123`
- `99999`
- `abc123`
- `qwerty`
- unrealistically long repeated digits

The backend rejects phone-like text that contains letters, too few digits, too many digits, or repeated fake digits.

### Name

Names are trimmed and checked for obvious fake values.

Rejected examples:

- `test`
- `testing`
- `abc`
- `qwerty`
- `asdf`
- `anonymous`
- `user`

A name is optional. A lead can be captured with valid email or valid phone even when no name is available.

Key file:

- `backend/src/leads/lead.service.ts`

## Anti-Spam Behavior

The backend does not create leads from invalid contact information.

If the visitor repeatedly provides invalid contact details, the capture service does not create a lead. The prompt also instructs the assistant to stop asking and continue helping normally.

This prevents fake leads from entering the dashboard and keeps the visitor experience non-pushy.

## Lead Scoring

When valid contact information is detected, the backend calculates both:

- numeric score percentage
- human-readable score label

Labels are:

- `LOW`
- `MEDIUM`
- `HIGH`

Scoring factors include:

- Pricing or plan discussion
- Enterprise or company needs
- Vendor evaluation or comparison
- Purchase timeline
- Organization size or scale
- Concrete business problem
- Demo or consultation requests
- Implementation, migration, integration, or custom setup questions
- Multiple buying questions
- Time spent on page
- Pricing, booking, demo, quote, or contact page visits
- Valid email shared
- Valid phone shared

The service also has an extensible `SUCCESS_PATTERN_WEIGHTS` hook so future successful-lead patterns can be weighted higher without changing the storage, dashboard, or API architecture.

The score is capped at 100.

## Stored Lead Data

When a valid lead is captured, the system stores:

- Name, if available
- Email, if valid
- Phone, if valid
- Conversation ID
- Website ID
- Visitor ID
- Session ID
- Interest
- Intent
- Lead score percentage
- Lead score label
- Reason
- Last question
- Pages visited
- Suggested next action
- Status
- Captured timestamp

Key schema objects:

- `Lead`
- `LeadScoreLabel`
- `LeadStatus`

Key files:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260712180000_add_leads/migration.sql`

## Duplicate Handling

Leads are upserted by conversation and contact method.

Unique constraints prevent duplicate rows for the same conversation/email or conversation/phone pair:

- `conversationId + email`
- `conversationId + phone`

If the same visitor provides updated valid information in the same conversation, the existing lead row is updated with the latest score, reason, and suggested next action.

## Leads API

A new authenticated dashboard API returns captured leads for the current organization.

Endpoint:

```text
GET /api/leads
```

Optional filter:

```text
GET /api/leads?websiteId=<website-id>
```

The response includes source website and conversation metadata so the dashboard can show context and link back to the conversation.

Key files:

- `backend/src/leads/lead.routes.ts`
- `backend/src/leads/lead.service.ts`
- `backend/src/server.ts`

## Dashboard

A new dashboard page was added at:

```text
/leads
```

It shows:

- Name
- Email
- Phone
- Interest
- Lead Score
- Intent
- Conversation
- Source Website
- Captured At
- Status
- Suggested Follow-up

The page also shows the last question, human-readable score reasons, and the pages visited when available.

Key files:

- `dashboard/src/app/(dashboard)/leads/page.tsx`
- `dashboard/src/app/(dashboard)/layout.tsx`
- `dashboard/src/lib/api.ts`

## Safety Guarantees

The final safety boundary is:

1. Prompt tells the AI to answer first and never gate value behind contact details.
2. Prompt limits asks to clear buying intent.
3. Prompt requires a useful resource in exchange.
4. Backend validates email, phone, and name before storage.
5. Backend rejects repeated invalid contact attempts.
6. Backend stores leads only after valid contact details are present.
7. Dashboard shows only validated captured leads.

## Verification Performed

Backend typecheck passed:

```text
npm run typecheck
```

Prisma schema validation passed:

```text
npx prisma validate
```

Targeted dashboard lint passed for the changed files:

```text
npx eslint "src/app/(dashboard)/leads/page.tsx" "src/app/(dashboard)/layout.tsx" "src/lib/api.ts"
```

Known notes:

- Full dashboard lint still reports pre-existing React hook lint errors in unrelated files.
- `npm run prisma:generate` was blocked by a Windows file lock on Prisma's query engine DLL. Stop the running Node/backend process and rerun `npm run prisma:generate` inside `backend`.

## Result

The AI now behaves like a helpful sales assistant instead of a form.

It answers first, asks only when the visitor has shown intent, offers something useful in return, validates contact details, avoids fake leads, scores the opportunity, and gives the business a clear Leads dashboard for follow-up.