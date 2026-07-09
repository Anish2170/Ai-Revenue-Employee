/**
 * All widget CSS, injected once into the shadow root. Uses CSS custom properties
 * for theming with an automatic dark mode via prefers-color-scheme. Animations
 * are GPU-friendly (transform/opacity only).
 */
export const STYLES = /* css */ `
:host, .aire-layer { all: initial; }

.aire-layer {
  --aire-accent: #4f46e5;
  --aire-accent-hover: #4338ca;
  --aire-bg: #ffffff;
  --aire-surface: #f8fafc;
  --aire-text: #0f172a;
  --aire-muted: #64748b;
  --aire-border: #e2e8f0;
  --aire-bubble-user: #4f46e5;
  --aire-bubble-user-text: #ffffff;
  --aire-bubble-ai: #f1f5f9;
  --aire-bubble-ai-text: #0f172a;
  --aire-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
  --aire-radius: 16px;

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  position: fixed;
  bottom: 20px;
  right: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
  z-index: 1;
}

@media (prefers-color-scheme: dark) {
  .aire-layer {
    --aire-bg: #0f172a;
    --aire-surface: #1e293b;
    --aire-text: #f1f5f9;
    --aire-muted: #94a3b8;
    --aire-border: #334155;
    --aire-bubble-ai: #1e293b;
    --aire-bubble-ai-text: #e2e8f0;
    --aire-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
  }
}

* { box-sizing: border-box; }
button { font-family: inherit; cursor: pointer; border: none; background: none; }

/* ---------- Launcher ---------- */
.aire-launcher {
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--aire-accent);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: var(--aire-shadow);
  transition: transform .2s ease, background .2s ease;
  transform: scale(1);
}
.aire-launcher:hover { background: var(--aire-accent-hover); transform: scale(1.05); }
.aire-launcher:active { transform: scale(.96); }
.aire-launcher svg { width: 26px; height: 26px; }
.aire-hidden { display: none !important; }

/* ---------- Popup ---------- */
.aire-popup {
  width: 320px; max-width: calc(100vw - 32px);
  background: var(--aire-bg);
  color: var(--aire-text);
  border: 1px solid var(--aire-border);
  border-radius: var(--aire-radius);
  box-shadow: var(--aire-shadow);
  padding: 18px 18px 16px;
  position: relative;
  animation: aire-pop-in .42s cubic-bezier(.16,1,.3,1);
  transform-origin: bottom right;
}
.aire-popup.aire-leaving { animation: aire-pop-out .25s ease forwards; }
.aire-popup__close {
  position: absolute; top: 10px; right: 10px;
  width: 26px; height: 26px; border-radius: 50%;
  color: var(--aire-muted); font-size: 18px; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s ease, color .15s ease;
}
.aire-popup__close:hover { background: var(--aire-surface); color: var(--aire-text); }
.aire-popup__brand {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; color: var(--aire-muted);
  text-transform: uppercase; letter-spacing: .04em; margin-bottom: 8px;
}
.aire-popup__dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 0 3px rgba(34,197,94,.18); }
.aire-popup__title { font-size: 15.5px; line-height: 1.35; font-weight: 700; color: var(--aire-text); margin: 0 28px 8px 0; }
.aire-popup__msg { font-size: 14.5px; line-height: 1.5; margin: 0 0 14px; padding-right: 18px; }
.aire-popup__cta {
  display: inline-flex; align-items: center; gap: 8px;
  background: var(--aire-accent); color: #fff;
  padding: 10px 16px; border-radius: 10px;
  font-size: 14px; font-weight: 600;
  transition: background .18s ease, transform .18s ease;
}
.aire-popup__cta:hover { background: var(--aire-accent-hover); transform: translateY(-1px); }

/* ---------- Chat ---------- */
.aire-chat {
  width: 380px; max-width: calc(100vw - 32px);
  height: 560px; max-height: calc(100vh - 40px);
  background: var(--aire-bg);
  border: 1px solid var(--aire-border);
  border-radius: var(--aire-radius);
  box-shadow: var(--aire-shadow);
  display: flex; flex-direction: column; overflow: hidden;
  transform-origin: bottom right;
  animation: aire-pop-in .34s cubic-bezier(.16,1,.3,1);
}
.aire-chat.aire-leaving { animation: aire-pop-out .22s ease forwards; }

.aire-chat__header {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; background: var(--aire-surface);
  border-bottom: 1px solid var(--aire-border);
}
.aire-chat__avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--aire-accent); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 15px;
}
.aire-chat__title { font-size: 14.5px; font-weight: 700; color: var(--aire-text); }
.aire-chat__status { font-size: 12px; color: var(--aire-muted); display: flex; align-items: center; gap: 6px; }
.aire-chat__status::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: #22c55e; }
.aire-chat__meta { min-width: 88px; }
.aire-chat__select {
  min-width: 0;
  max-width: 132px;
  height: 32px;
  border: 1px solid var(--aire-border);
  border-radius: 8px;
  background: var(--aire-bg);
  color: var(--aire-text);
  font-size: 12px;
  padding: 0 8px;
  outline: none;
}
.aire-chat__new {
  color: var(--aire-muted);
  font-size: 18px;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background .15s, color .15s;
}
.aire-chat__new:hover { background: var(--aire-border); color: var(--aire-text); }
.aire-chat__header-spacer { flex: 1; }
.aire-chat__min { color: var(--aire-muted); font-size: 22px; width: 30px; height: 30px; border-radius: 8px; display:flex; align-items:center; justify-content:center; transition: background .15s; }
.aire-chat__min:hover { background: var(--aire-border); }

.aire-chat__messages {
  flex: 1; overflow-y: auto; padding: 16px;
  display: flex; flex-direction: column; gap: 10px;
  scroll-behavior: smooth;
}
.aire-msg {
  max-width: 82%; padding: 10px 13px; font-size: 14px; line-height: 1.5;
  border-radius: 14px; white-space: pre-wrap; word-wrap: break-word;
  animation: aire-msg-in .26s ease;
}
.aire-msg--user { align-self: flex-end; background: var(--aire-bubble-user); color: var(--aire-bubble-user-text); border-bottom-right-radius: 4px; }
.aire-msg--ai { align-self: flex-start; background: var(--aire-bubble-ai); color: var(--aire-bubble-ai-text); border-bottom-left-radius: 4px; }

.aire-source {
  align-self: flex-start;
  max-width: 82%;
  margin-top: -4px;
  animation: aire-msg-in .26s ease;
}
.aire-source__label {
  color: var(--aire-muted);
  font-size: 11px;
  font-weight: 700;
  margin: 0 0 5px 2px;
  text-transform: uppercase;
}
.aire-source__button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  min-height: 34px;
  padding: 8px 11px;
  border: 1px solid var(--aire-border);
  border-radius: 10px;
  background: var(--aire-bg);
  color: var(--aire-text);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.25;
  text-align: left;
  box-shadow: 0 6px 16px rgba(15, 23, 42, 0.08);
  transition: border-color .15s ease, color .15s ease, transform .15s ease;
}
.aire-source__button:hover {
  border-color: var(--aire-accent);
  color: var(--aire-accent);
  transform: translateY(-1px);
}
.aire-source__button svg {
  width: 15px;
  height: 15px;
  flex: none;
}
.aire-source__button span {
  overflow: hidden;
  text-overflow: ellipsis;
}

.aire-typing { display: inline-flex; gap: 4px; align-items: center; padding: 4px 2px; }
.aire-typing span { width: 7px; height: 7px; border-radius: 50%; background: var(--aire-muted); opacity: .5; animation: aire-blink 1.2s infinite; }
.aire-typing span:nth-child(2) { animation-delay: .2s; }
.aire-typing span:nth-child(3) { animation-delay: .4s; }

.aire-chat__composer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 12px; border-top: 1px solid var(--aire-border); background: var(--aire-bg);
}
.aire-chat__input {
  flex: 1; resize: none; max-height: 96px;
  background: var(--aire-surface); color: var(--aire-text);
  border: 1px solid var(--aire-border); border-radius: 12px;
  padding: 10px 12px; font-size: 14px; line-height: 1.4; outline: none;
  transition: border-color .15s ease;
}
.aire-chat__input::placeholder { color: var(--aire-muted); }
.aire-chat__input:focus { border-color: var(--aire-accent); }
.aire-chat__send {
  width: 40px; height: 40px; border-radius: 11px; flex: none;
  background: var(--aire-accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s ease, transform .15s ease;
}
.aire-chat__send:hover:not(:disabled) { background: var(--aire-accent-hover); }
.aire-chat__send:disabled { opacity: .45; cursor: not-allowed; }
.aire-chat__send svg { width: 18px; height: 18px; }

/* ---------- Animations ---------- */
@keyframes aire-pop-in { from { opacity: 0; transform: translateY(12px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes aire-pop-out { to { opacity: 0; transform: translateY(8px) scale(.96); } }
@keyframes aire-msg-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes aire-blink { 0%, 60%, 100% { opacity: .35; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-2px); } }

@media (max-width: 480px) {
  .aire-layer { bottom: 12px; right: 12px; left: 12px; align-items: flex-end; }
  .aire-chat { width: 100%; height: 70vh; }
  .aire-popup { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .aire-popup, .aire-chat, .aire-msg, .aire-launcher { animation: none !important; transition: none !important; }
}
`;
