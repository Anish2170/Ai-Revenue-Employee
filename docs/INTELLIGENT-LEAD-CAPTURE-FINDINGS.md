# Intelligent Lead Capture Findings

## Current Pipeline Finding

The lead capture pipeline is executing after the assistant response.

The backend evaluates the conversation after the assistant has streamed and saved its response. Lead storage still only happens after a valid email or phone number exists, so the email request itself must be produced by the LLM in the assistant response.

## Why Gemini Was Skipping Email Capture

The previous prompt made the ask too optional.

Weak wording included:

- deciding whether to ask
- if a follow-up offer is appropriate
- normally ask
- ask softly

Those instructions were present and not truncated, but Gemini could reasonably skip the email ask because stronger nearby instructions emphasized:

- be concise
- answer first
- answer only from business knowledge
- do not invent details

That made Gemini treat a follow-up resource offer as optional or potentially outside the knowledge base.

## Prompt Improvement Made

The prompt now clarifies:

- Business facts must come only from business knowledge.
- Conversational follow-up offers are allowed for MEDIUM/HIGH buying intent.
- The AI must still never invent factual business claims.
- For MEDIUM/HIGH intent, the response flow is: answer first, offer useful follow-up, ask for email in the same response.

The prompt now uses stronger wording:

```text
Required response flow for MEDIUM or HIGH intent when the visitor has not declined: first answer the user's question completely from business knowledge, then offer one genuinely useful follow-up resource, then ask for the email in the same response.
```

## Scoring Finding

The previous scoring was too conservative.

Examples like:

```text
We're planning to hire a law firm next month.
```

could score too low if only one signal matched. Real sales behavior treats purchase timeline, company scale, implementation needs, proposal requests, provider switching, and ongoing support as high-intent signals.

## Scoring Improvement Made

Weights were increased for real buying signals:

- Purchase or hiring timeline
- Company scale
- Implementation, migration, or setup
- Provider switching
- Proposal or quote requests
- Ongoing legal/business support
- Vendor/firm/platform comparison

Context boosts were added for:

- near-term purchase or hiring decisions
- active provider evaluation
- organization size tied to a business need
- visitor speaking on behalf of a company/team

Intent name now uses the strongest matched signal, not the first matched signal.

## Verification Results

Deterministic scoring check now gives:

| Conversation | Expected | Result |
|---|---|---|
| We're planning to hire a law firm next month. | HIGH | HIGH |
| We're comparing three law firms. | MEDIUM | MEDIUM |
| I'm just curious. | LOW | LOW |
| We have 300 employees and need ongoing legal support. | HIGH | HIGH |

Backend typecheck passed:

```text
npm run typecheck
```

## What Was Not Changed

No architecture redesign was done.

Unchanged:

- database schema
- lead storage
- validation
- dashboard
- APIs
- conversation route structure

Only prompt behavior and scoring quality were improved.