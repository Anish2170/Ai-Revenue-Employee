/**
 * All widget CSS, injected once into the shadow root. The visual language mirrors
 * the AI Revenue Employee landing page while keeping widget behavior isolated.
 */
export const STYLES = /* css */ `
:host, .aire-layer { all: initial; }

.aire-layer {
  --aire-bg: #f7f5f2;
  --aire-panel: #ffffff;
  --aire-surface: #f7f3f2;
  --aire-layer: #f1edec;
  --aire-text: #111111;
  --aire-muted: #444748;
  --aire-subtle: #747878;
  --aire-border: #c4c7c7;
  --aire-soft-border: #e5e7eb;
  --aire-accent: #18453b;
  --aire-accent-hover: #143a32;
  --aire-brass: #b08d57;
  --aire-danger: #ef4444;
  --aire-success: #22c55e;
  --aire-bubble-user: #18453b;
  --aire-bubble-user-text: #ffffff;
  --aire-bubble-ai: #f7f3f2;
  --aire-bubble-ai-text: #111111;
  --aire-shadow: 0 28px 70px rgba(17, 17, 17, 0.22), 0 8px 22px rgba(17, 17, 17, 0.10);
  --aire-radius: 20px;

  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
  z-index: 1;
  color: var(--aire-text);
}

* { box-sizing: border-box; }
button, input, textarea, select { font: inherit; }
button { cursor: pointer; border: none; background: none; }
.aire-hidden { display: none !important; }

/* ---------- Launcher ---------- */
.aire-launcher {
  width: 60px;
  height: 60px;
  border-radius: 18px;
  background: var(--aire-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--aire-shadow);
  transition: transform .18s ease, background .18s ease, box-shadow .18s ease;
  transform: scale(1);
}
.aire-launcher:hover { background: var(--aire-accent-hover); transform: translateY(-2px); box-shadow: 0 32px 76px rgba(17,17,17,.24), 0 10px 24px rgba(17,17,17,.12); }
.aire-launcher:active { transform: translateY(0) scale(.98); }
.aire-launcher svg { width: 26px; height: 26px; }

/* ---------- Popup ---------- */
.aire-popup {
  width: 340px;
  max-width: calc(100vw - 32px);
  background: var(--aire-panel);
  color: var(--aire-text);
  border: 1px solid var(--aire-soft-border);
  border-radius: 18px;
  box-shadow: var(--aire-shadow);
  padding: 20px;
  position: relative;
  animation: aire-pop-in .42s cubic-bezier(.16,1,.3,1);
  transform-origin: bottom right;
}
.aire-popup.aire-leaving { animation: aire-pop-out .25s ease forwards; }
.aire-popup__close {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  color: var(--aire-muted);
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.aire-popup__close:hover { background: var(--aire-surface); color: var(--aire-text); transform: translateY(-1px); }
.aire-popup__brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  color: var(--aire-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.aire-popup__dot { width: 8px; height: 8px; border-radius: 999px; background: var(--aire-success); box-shadow: 0 0 0 4px rgba(34,197,94,.14); }
.aire-popup__title { margin: 0 36px 8px 0; color: var(--aire-text); font-size: 16px; line-height: 1.4; font-weight: 700; letter-spacing: 0; }
.aire-popup__msg { margin: 0 0 16px; color: var(--aire-muted); font-size: 14.5px; line-height: 1.6; padding-right: 12px; }
.aire-popup__actions { display: flex; flex-wrap: wrap; gap: 8px; }
.aire-popup__cta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--aire-accent);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .05em;
  transition: opacity .16s ease, transform .16s ease, background .16s ease;
}
.aire-popup__cta:hover { background: var(--aire-accent-hover); transform: translateY(-1px); }
.aire-popup__cta--secondary { background: #fff; color: var(--aire-text); border: 1px solid var(--aire-soft-border); }
.aire-popup__cta--secondary:hover { background: #f9fafb; }
.aire-popup__cta svg { width: 15px; height: 15px; }

/* ---------- Chat ---------- */
.aire-chat {
  width: 430px;
  max-width: calc(100vw - 32px);
  height: 680px;
  max-height: calc(100vh - 40px);
  background: var(--aire-panel);
  border: 1px solid var(--aire-soft-border);
  border-radius: var(--aire-radius);
  box-shadow: var(--aire-shadow);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform-origin: bottom right;
  animation: aire-pop-in .34s cubic-bezier(.16,1,.3,1);
}
.aire-chat.aire-leaving { animation: aire-pop-out .22s ease forwards; }

.aire-chat__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 18px 18px 14px;
  background: rgba(253,248,248,.92);
  backdrop-filter: blur(10px);
}
.aire-chat__avatar,
.aire-message-avatar {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  background: var(--aire-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: .02em;
  box-shadow: 0 8px 18px rgba(24,69,59,.18);
}
.aire-chat__meta { min-width: 0; flex: 1; }
.aire-chat__title { color: var(--aire-text); font-size: 15px; line-height: 20px; font-weight: 700; letter-spacing: 0; }
.aire-chat__status { margin-top: 2px; color: var(--aire-muted); font-size: 12px; line-height: 16px; display: flex; align-items: center; gap: 6px; }
.aire-chat__status::before { content: ""; width: 7px; height: 7px; border-radius: 999px; background: var(--aire-success); box-shadow: 0 0 0 3px rgba(34,197,94,.15); }
.aire-chat__select {
  min-width: 0;
  max-width: 92px;
  height: 34px;
  border: 1px solid var(--aire-soft-border);
  border-radius: 10px;
  background: #fff;
  color: var(--aire-muted);
  font-size: 12px;
  padding: 0 8px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.aire-chat__select:focus { border-color: var(--aire-text); box-shadow: 0 0 0 3px rgba(17,17,17,.05); }
.aire-chat__new,
.aire-chat__min,
.aire-chat__close {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--aire-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.aire-chat__new:hover,
.aire-chat__min:hover,
.aire-chat__close:hover { background: var(--aire-surface); color: var(--aire-text); transform: translateY(-1px); }
.aire-chat__new svg,
.aire-chat__min svg,
.aire-chat__close svg { width: 17px; height: 17px; }

.aire-chat__messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  scroll-behavior: smooth;
  background: linear-gradient(180deg, #fff 0%, var(--aire-bg) 100%);
}
.aire-chat__messages::-webkit-scrollbar { width: 8px; }
.aire-chat__messages::-webkit-scrollbar-track { background: transparent; }
.aire-chat__messages::-webkit-scrollbar-thumb { background: rgba(68,71,72,.22); border-radius: 999px; border: 2px solid transparent; background-clip: content-box; }
.aire-chat__messages::-webkit-scrollbar-thumb:hover { background: rgba(68,71,72,.36); border: 2px solid transparent; background-clip: content-box; }

.aire-message-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 100%;
  animation: aire-msg-in .24s ease;
}
.aire-message-row--user { justify-content: flex-end; }
.aire-message-row--ai { justify-content: flex-start; }
.aire-message-row--grouped { margin-top: -8px; }
.aire-message-stack { display: flex; flex-direction: column; max-width: 72%; }
.aire-message-row--user .aire-message-stack { align-items: flex-end; }
.aire-message-avatar { width: 30px; height: 30px; border-radius: 10px; font-size: 10px; align-self: flex-end; }
.aire-message-avatar--hidden { opacity: 0; }

.aire-msg {
  max-width: 100%;
  padding: 16px 17px;
  border-radius: 18px;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.6;
  letter-spacing: 0;
}
.aire-msg--user {
  background: var(--aire-bubble-user);
  color: var(--aire-bubble-user-text);
  border-bottom-right-radius: 7px;
  box-shadow: 0 8px 18px rgba(24,69,59,.14);
}
.aire-msg--ai {
  background: var(--aire-bubble-ai);
  color: var(--aire-bubble-ai-text);
  border: 1px solid var(--aire-soft-border);
  border-bottom-left-radius: 7px;
}
.aire-msg__time {
  margin-top: 5px;
  color: var(--aire-subtle);
  font-size: 11px;
  line-height: 14px;
  opacity: 0;
  transform: translateY(-2px);
  transition: opacity .15s ease, transform .15s ease;
}
.aire-message-row:hover .aire-msg__time { opacity: 1; transform: translateY(0); }

.aire-skeleton-row {
  display: flex;
  width: 100%;
  animation: aire-msg-in .24s ease;
}
.aire-skeleton-row--user { justify-content: flex-end; }
.aire-skeleton-bubble {
  width: 68%;
  height: 54px;
  border-radius: 18px;
  background: linear-gradient(90deg, var(--aire-surface) 0%, #ffffff 48%, var(--aire-surface) 100%);
  background-size: 220% 100%;
  border: 1px solid var(--aire-soft-border);
  animation: aire-shimmer 1.2s ease-in-out infinite;
}
.aire-skeleton-row--user .aire-skeleton-bubble { width: 52%; background: linear-gradient(90deg, rgba(24,69,59,.10), rgba(24,69,59,.04), rgba(24,69,59,.10)); background-size: 220% 100%; }
.aire-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-left: 40px;
  margin-top: -4px;
  animation: aire-msg-in .24s ease;
}
.aire-suggestion-chip {
  min-height: 34px;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--aire-soft-border);
  background: #fff;
  color: var(--aire-text);
  font-size: 13px;
  font-weight: 650;
  transition: border-color .15s ease, color .15s ease, transform .15s ease, background .15s ease;
}
.aire-suggestion-chip:hover { border-color: var(--aire-accent); color: var(--aire-accent); background: var(--aire-surface); transform: translateY(-1px); }

.aire-source {
  align-self: flex-start;
  max-width: calc(72% + 40px);
  margin-left: 40px;
  margin-top: -6px;
  animation: aire-msg-in .24s ease;
}
.aire-source__label {
  color: var(--aire-muted);
  font-size: 10px;
  font-weight: 800;
  margin: 0 0 6px 2px;
  letter-spacing: .05em;
  text-transform: uppercase;
}
.aire-source__button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  min-height: 38px;
  padding: 9px 12px;
  border: 1px solid var(--aire-soft-border);
  border-radius: 12px;
  background: #fff;
  color: var(--aire-text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
  text-align: left;
  box-shadow: 0 1px 2px rgba(0,0,0,.05);
  transition: border-color .15s ease, color .15s ease, transform .15s ease;
}
.aire-source__button:hover { border-color: var(--aire-accent); color: var(--aire-accent); transform: translateY(-1px); }
.aire-source__button svg { width: 15px; height: 15px; flex: none; }
.aire-source__button span { overflow: hidden; text-overflow: ellipsis; }

.aire-lead-card {
  align-self: flex-start;
  width: min(82%, 328px);
  margin-left: 40px;
  padding: 16px;
  border: 1px solid var(--aire-soft-border);
  border-radius: 18px;
  background: #fff;
  color: var(--aire-text);
  box-shadow: 0 14px 34px rgba(17,17,17,.10);
  animation: aire-card-in .24s ease;
}
.aire-lead-card__title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--aire-text);
  font-size: 15px;
  font-weight: 750;
  line-height: 1.35;
}
.aire-lead-card__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: rgba(24,69,59,.10);
  color: var(--aire-accent);
  font-size: 0;
  flex: none;
}
.aire-lead-card__icon::before {
  content: "";
  width: 15px;
  height: 15px;
  display: block;
  background: currentColor;
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='16' x='2' y='4' rx='2'/%3E%3Cpath d='m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7'/%3E%3C/svg%3E") center / contain no-repeat;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect width='20' height='16' x='2' y='4' rx='2'/%3E%3Cpath d='m22 7-8.97 5.7a2 2 0 0 1-2.06 0L2 7'/%3E%3C/svg%3E") center / contain no-repeat;
}
.aire-lead-card__subtitle { margin-top: 9px; color: var(--aire-muted); font-size: 13px; line-height: 1.55; }
.aire-lead-card__label { display: flex; flex-direction: column; gap: 7px; margin-top: 14px; color: var(--aire-text); font-size: 11px; font-weight: 750; letter-spacing: .05em; text-transform: uppercase; }
.aire-lead-card__input {
  width: 100%;
  min-height: 42px;
  border: 1px solid var(--aire-soft-border);
  border-radius: 12px;
  background: #fff;
  color: var(--aire-text);
  padding: 10px 12px;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease, opacity .15s ease;
}
.aire-lead-card__input::placeholder { color: var(--aire-subtle); }
.aire-lead-card__input:focus { border-color: var(--aire-text); box-shadow: 0 0 0 3px rgba(17,17,17,.05); }
.aire-lead-card__input[aria-invalid="true"] { border-color: var(--aire-danger); box-shadow: 0 0 0 3px rgba(239,68,68,.10); }
.aire-lead-card__input:disabled { opacity: .72; cursor: not-allowed; }
.aire-lead-card__error { min-height: 16px; margin-top: 6px; color: var(--aire-danger); font-size: 12px; line-height: 1.35; }
.aire-lead-card__button,
.aire-lead-card__secondary {
  width: 100%;
  min-height: 42px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 750;
  letter-spacing: .05em;
  transition: background .15s ease, opacity .15s ease, transform .15s ease, border-color .15s ease;
}
.aire-lead-card__button { margin-top: 2px; background: var(--aire-accent); color: #fff; }
.aire-lead-card__button:hover:not(:disabled) { background: var(--aire-accent-hover); transform: translateY(-1px); }
.aire-lead-card__button:disabled { opacity: .75; cursor: not-allowed; }
.aire-lead-card__button--saved { background: var(--aire-success); opacity: 1 !important; }
.aire-lead-card__secondary { margin-top: 8px; border: 1px solid var(--aire-soft-border); background: #fff; color: var(--aire-muted); }
.aire-lead-card__secondary:hover { background: var(--aire-surface); color: var(--aire-text); transform: translateY(-1px); }

.aire-typing { display: inline-flex; gap: 5px; align-items: center; padding: 6px 1px; }
.aire-typing span { width: 7px; height: 7px; border-radius: 999px; background: var(--aire-muted); opacity: .45; animation: aire-blink 1.2s infinite; }
.aire-typing span:nth-child(2) { animation-delay: .16s; }
.aire-typing span:nth-child(3) { animation-delay: .32s; }

.aire-chat__composer {
  padding: 14px 16px 16px;
  background: rgba(253,248,248,.96);
}
.aire-chat__composer::before { content: ""; display: block; height: 1px; margin: -14px -16px 14px; background: var(--aire-soft-border); }
.aire-chat__composer {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.aire-chat__input {
  flex: 1;
  resize: none;
  max-height: 112px;
  min-height: 46px;
  background: #fff;
  color: var(--aire-text);
  border: 1px solid var(--aire-soft-border);
  border-radius: 16px;
  padding: 12px 14px;
  font-size: 15px;
  line-height: 1.5;
  outline: none;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.aire-chat__input::placeholder { color: var(--aire-subtle); }
.aire-chat__input:focus { border-color: var(--aire-text); box-shadow: 0 0 0 3px rgba(17,17,17,.05); }
.aire-chat__send {
  position: relative;
  width: 46px;
  height: 46px;
  border-radius: 999px;
  flex: none;
  background: var(--aire-accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s ease, transform .15s ease, opacity .15s ease;
}
.aire-chat__send:hover:not(:disabled) { background: var(--aire-accent-hover); transform: translateY(-1px); }
.aire-chat__send:disabled { opacity: .62; cursor: not-allowed; }
.aire-chat__send svg { width: 18px; height: 18px; transition: opacity .12s ease; }
.aire-chat__send:disabled svg { opacity: 0; }
.aire-chat__send:disabled::after {
  content: "";
  position: absolute;
  width: 17px;
  height: 17px;
  border-radius: 999px;
  border: 2px solid rgba(255,255,255,.45);
  border-top-color: #fff;
  animation: aire-spin .7s linear infinite;
}

/* ---------- Animations ---------- */
@keyframes aire-pop-in { from { opacity: 0; transform: translateY(14px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes aire-pop-out { to { opacity: 0; transform: translateY(8px) scale(.96); } }
@keyframes aire-msg-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes aire-card-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes aire-blink { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
@keyframes aire-spin { to { transform: rotate(360deg); } }
@keyframes aire-shimmer { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }

@media (max-width: 480px) {
  .aire-layer { bottom: 12px; right: 12px; left: 12px; align-items: flex-end; }
  .aire-chat { width: 100%; height: min(680px, 76vh); max-height: calc(100vh - 24px); border-radius: 20px; }
  .aire-popup { width: 100%; }
  .aire-chat__header { padding: 16px 14px 12px; gap: 8px; }
  .aire-chat__select { display: none; }
  .aire-chat__messages { padding: 18px 14px 16px; }
  .aire-message-stack { max-width: 78%; }
  .aire-source, .aire-lead-card { margin-left: 40px; }
  .aire-msg { font-size: 15px; padding: 14px 15px; }
}

@media (prefers-reduced-motion: reduce) {
  .aire-popup,
  .aire-chat,
  .aire-msg,
  .aire-launcher,
  .aire-message-row,
  .aire-lead-card,
  .aire-skeleton-row,
  .aire-skeleton-bubble,
  .aire-suggestions {
    animation: none !important;
    transition: none !important;
  }
}
`;


