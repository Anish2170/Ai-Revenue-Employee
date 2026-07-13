/**
 * Business Instructions loader.
 *
 * Sprint 2: a local JSON file (`backend/config/business-instructions.json`)
 * defines AI behaviour (tone, alwaysBookDemo, avoidDiscounts, language). Later
 * this moves to the dashboard — callers only see {@link getBusinessInstructions}.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BusinessInstructions } from './types.js';

// backend/src/context (dev) or backend/dist/context (prod) → backend/
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTRUCTIONS_PATH = resolve(backendRoot, 'config', 'business-instructions.json');

const DEFAULTS: BusinessInstructions = {
  businessName: 'this business',
  companyDescription: '',
  role: '',
  tone: 'Professional, helpful, and concise.',
  goal: '',
  context: '',
  rules: '',
  fallbackMessage: '',
  alwaysBookDemo: false,
  avoidDiscounts: false,
  language: 'English',
  websiteUrl: '',
};

let cached: BusinessInstructions | null = null;

/** Load (and cache) the business instructions, falling back to safe defaults. */
export function getBusinessInstructions(): BusinessInstructions {
  if (cached) return cached;
  try {
    const raw = readFileSync(INSTRUCTIONS_PATH, 'utf8');
    cached = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<BusinessInstructions>) };
  } catch {
    console.warn('[knowledge] business-instructions.json not found — using defaults.');
    cached = { ...DEFAULTS };
  }
  return cached;
}
