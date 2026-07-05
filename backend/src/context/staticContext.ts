/**
 * Business context for Sprint 1 — populated with the real Creovix AI website
 * content (services, positioning, pricing, curated FAQs, contact/booking).
 *
 * This is the ONLY place business facts are hardcoded. It is hidden behind the
 * Context Provider so Sprint 3+ can replace it with a crawler/RAG over the live
 * site without any caller changing. FAQs are intentionally curated (not all 30)
 * to keep the chat prompt token-efficient while covering the common questions.
 */
import type { BusinessContext } from '../types.js';

export const staticBusinessContext: BusinessContext = {
  name: 'Creovix AI',
  description:
    'Creovix AI builds autonomous, context-aware AI employees and automations that handle customer support, qualify and follow up with leads, and book sales calls — across web chat, email, SMS, WhatsApp, and voice.',
  positioning:
    'AI Employees That Grow Your Business — deploy digital workers that manage support pipelines, answer inquiries, qualify leads, and book calls automatically, with sub-500ms response latency and SOC2/HIPAA/GDPR-grade security.',
  services: [
    'AI Chatbots — 24/7 web chat that answers questions and captures leads',
    'AI Employees — autonomous agents for inbox, lead qualification, and reporting',
    'AI Voice Agents — human-like inbound/outbound phone agents (~500ms latency)',
    'Workflow Automation — connect apps via Make/Zapier/custom APIs',
    'CRM Automation — self-updating HubSpot/Salesforce/Pipedrive pipelines',
    'WhatsApp Automation — official Cloud API marketing, support, and sales flows',
    'Custom AI Software — bespoke LLM fine-tuning, RAG, and predictive models',
  ],
  pricingSummary:
    'Three plans (20% off annual): Starter $499/mo (1,500 conversations, 2 AI employees, web+email, standard CRM sync). Growth $1,499/mo — most popular (6,000 conversations, 5 AI employees, web/email/SMS/WhatsApp, native HubSpot & Salesforce, dedicated Slack support). Enterprise $2,999/mo (unlimited conversations & employees, voice agents, custom API/DB, fine-tuned models, SOC2+HIPAA+GDPR, 1-hour SLA). 14-day free trial on Growth, no credit card. No setup fees on Starter/Growth.',
  tone: 'Helpful, concise, and consultative — like a knowledgeable solutions engineer. Never pushy. Answer the question first, then offer a relevant next step (demo or contact) when it fits.',
  faqs: [
    {
      q: 'Do you offer a free trial?',
      a: 'Yes — a 14-day free trial on the Growth plan: up to 200 free conversation logs, 2 custom-trained AI employees, and native CRM integrations. No credit card required.',
    },
    {
      q: 'How is a "conversation" counted?',
      a: 'One conversation is a continuous interaction with a unique visitor within a 24-hour window — whether they send 2 messages or 50, it counts as one.',
    },
    {
      q: 'What if I exceed my plan limits?',
      a: 'Your agents keep working. On Starter/Growth you are billed a small overage of $0.15 per extra conversation, or you can auto-upgrade to the next tier anytime.',
    },
    {
      q: 'Are there setup fees?',
      a: 'No setup fees on Starter or Growth. Enterprise plans needing custom model training or bespoke integrations have a one-time onboarding fee scoped to the engineering work.',
    },
    {
      q: 'How long does deployment take?',
      a: 'Standard chatbots and workflow automations deploy in under 2 hours. Enterprise setups with custom LLMs or voice agents typically take 5–10 business days.',
    },
    {
      q: 'Do I need coding skills to train an agent?',
      a: 'No. You drag-and-drop training files (PDFs, docs, spreadsheets) or add website URLs in the dashboard, and the system updates the agent knowledge base automatically.',
    },
    {
      q: 'Is my data secure and compliant?',
      a: 'Yes. TLS 1.3 in transit, AES-256 at rest, per-tenant isolation. SOC2 Type II; HIPAA (with BAAs) and GDPR supported on Enterprise. You retain 100% ownership of your data and we never train public models on it.',
    },
    {
      q: 'Which integrations do you support?',
      a: 'Native HubSpot, Salesforce, Pipedrive, ActiveCampaign, plus Slack, Make, Zapier, Stripe, Twilio, WhatsApp Cloud API, custom webhooks/REST APIs, and (Enterprise) direct SQL read/write.',
    },
    {
      q: 'What languages do agents support?',
      a: 'Over 80 languages with automatic language detection; voice agents can be trained with specific regional accents.',
    },
    {
      q: 'When does it escalate to a human?',
      a: 'Escalation is customizable — common triggers include a direct request to talk to a person, negative sentiment, repeated unresolved queries, or sensitive account changes.',
    },
  ],
  contact:
    'Book a 30-minute automation strategy call (Zoom) on the Book a Demo page, use the Contact form, email hello@creovix.ai, or call +1 (555) 304-9423 (Mon–Fri 9am–6pm PST, support 24/7). Inquiries answered within ~4 hours.',
  siteLinks: [
    { label: 'Book a demo', url: '/book-demo' },
    { label: 'See pricing', url: '/pricing' },
    { label: 'Explore services', url: '/services' },
    { label: 'View case studies', url: '/case-studies' },
    { label: 'Contact us', url: '/contact' },
    { label: 'About us', url: '/about' },
  ],
};
