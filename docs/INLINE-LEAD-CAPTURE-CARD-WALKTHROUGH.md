# Inline Lead Capture Card Walkthrough

## Goal

The chat widget now renders a native inline Lead Capture Card when the assistant asks for the visitor's email.

The AI conversation remains unchanged. The assistant still naturally says something like:

```text
I can also send you our pricing comparison and implementation guide.

What's the best email address to send it to?
```

Immediately below that assistant message, the widget renders an inline email form so the visitor does not need to type their email as a normal chat message.

## Scope

This change is frontend-only.

Unchanged:

- Lead scoring
- Prompt
- APIs
- Database
- Backend validation
- Dashboard
- Conversation flow
- Lead storage rules

The card submits through the existing chat endpoint so the current backend lead capture pipeline continues to validate and store leads normally.

## Trigger

The widget checks assistant messages after they render.

A Lead Capture Card appears only when the assistant message actually asks for an email, using patterns such as:

- `best email`
- `email address`
- `what's your email`
- `what's the best email`
- `email it to you`
- `send ... email`
- `send ... inbox`

The card does not appear for a generic resource offer unless the assistant asks for email.

If the text includes decline language such as `no thanks`, `not now`, or `do not email`, the card is not shown.

Key file:

- `widget/src/chat/chat.ts`

## Card UI

The inline card is rendered inside the message list, directly under the assistant message.

Card content:

```text
Get Your Resource
Enter your email below and we'll use it to send the information discussed.

Email Address
[you@example.com]

[Send]
```

There is intentionally no `Not Now` button. If the visitor does not want to provide an email, they can ignore the card and continue chatting.

Key files:

- `widget/src/chat/chat.ts`
- `widget/src/ui/styles.ts`

## Validation

Email validation happens in the widget before any request is sent.

Valid email shape:

```text
name@example.com
```

If invalid, the widget shows inline validation:

```text
Please enter a valid email address.
```

Invalid emails are not sent to the backend.

## Submission Flow

When the visitor submits a valid email:

1. The input is disabled.
2. The button changes to `Saving...`.
3. The widget sends a hidden chat message through the existing `/chat` stream:

```text
My email is visitor@example.com
```

4. The backend receives the email through the normal chat pipeline.
5. Existing backend validation and lead storage handle the lead.
6. On completion, the button changes to:

```text
Email Saved
```

The submission is quiet in the UI. It does not render an extra user bubble or assistant response for the hidden email handoff.

## Success State

After successful submission:

- Input remains disabled.
- Button remains disabled.
- Button shows `Email Saved`.
- The conversation remains usable.
- Visitor can keep chatting normally.

## Failure State

If the hidden chat submission fails:

- The button returns to `Send`.
- The input remains available for retry.
- No invalid lead is stored.

## Styling

The card uses the widget's existing theme variables:

- `--aire-bg`
- `--aire-surface`
- `--aire-text`
- `--aire-muted`
- `--aire-border`
- `--aire-accent`

It is styled to feel like a native part of the dark/light chat widget, with:

- rounded corners
- compact spacing
- inline validation
- accent-colored submit button
- green saved state

Key file:

- `widget/src/ui/styles.ts`

## Files Changed

Widget source:

- `widget/src/chat/chat.ts`
- `widget/src/ui/styles.ts`

Built artifact:

- `backend/public/widget.js`

## Verification

Widget typecheck passed:

```text
npm run typecheck
```

Widget build passed:

```text
npm run build
```

The build updates:

```text
backend/public/widget.js
```

## Result

The visitor now gets a smoother lead capture experience:

- The AI still asks naturally in the conversation.
- The widget detects the email ask.
- A native inline form appears immediately below the assistant message.
- Invalid emails are blocked client-side.
- Valid emails flow through the existing backend lead capture pipeline.
- The user is never forced to choose `Not Now` or interact with a popup.