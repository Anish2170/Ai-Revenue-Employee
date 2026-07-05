/**
 * Floating chat window. Owns the conversation, renders streaming assistant
 * replies with a typing indicator, and talks to the backend via {@link ApiClient}.
 * Conversation history is kept on the instance so it survives close/reopen.
 */
import { el } from '../utils/dom.js';
import type { ApiClient } from '../api/client.js';
import type { ChatMessage, ChatSource, VisitorBehaviour } from '../types.js';

const SEND_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

const SOURCE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';

export class ChatWindow {
  private panel: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private history: ChatMessage[] = [];
  private streaming = false;
  private abort: (() => void) | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly api: ApiClient,
    private readonly getBehaviour: () => VisitorBehaviour,
    private readonly onClose: () => void,
  ) {}

  get isOpen(): boolean {
    return this.panel !== null;
  }

  /**
   * Open the chat.
   * @param opener - optional first assistant message to seed the conversation
   *   with (e.g. the popup's message). It is shown AND added to history so the
   *   AI has context for the visitor's reply. Falls back to a generic greeting.
   */
  open(opener?: string): void {
    // Already open (e.g. a new popup's CTA while chatting): just seed the new
    // opener onto the existing conversation.
    if (this.panel) {
      this.seedOpener(opener);
      requestAnimationFrame(() => this.input?.focus());
      return;
    }

    this.render();

    // Re-render any prior conversation.
    this.history.forEach((m) => {
      this.appendBubble(m.role === 'user' ? 'user' : 'ai', m.content);
      if (m.role === 'assistant' && m.source) this.appendSource(m.source);
    });

    // Seed: a provided opener (the popup message), or a generic greeting only
    // when the conversation is brand new.
    if (opener && opener.trim()) {
      this.seedOpener(opener);
    } else if (this.history.length === 0) {
      this.seedOpener('Hi! I can help answer your questions. What would you like to know?');
    }

    requestAnimationFrame(() => this.input?.focus());
  }

  /**
   * Append an assistant "opener" message (popup text or greeting) to the
   * conversation and render it. No-op if it's empty or already the last message,
   * so reopening the chat or seeing the same popup twice never duplicates it.
   */
  private seedOpener(opener?: string): void {
    const text = opener?.trim();
    if (!text) return;
    const last = this.history[this.history.length - 1];
    if (last && last.role === 'assistant' && last.content === text) return;
    this.history.push({ role: 'assistant', content: text });
    this.appendBubble('ai', text);
  }

  close(): void {
    if (!this.panel) return;
    this.abort?.();
    const panel = this.panel;
    panel.classList.add('aire-leaving');
    this.panel = null;
    this.messagesEl = null;
    this.input = null;
    this.sendBtn = null;
    setTimeout(() => panel.remove(), 220);
    this.onClose();
  }

  private render(): void {
    const panel = el('div', 'aire-chat');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with assistant');

    // Header.
    const header = el('div', 'aire-chat__header');
    const avatar = el('div', 'aire-chat__avatar', 'AI');
    const meta = el('div');
    meta.appendChild(el('div', 'aire-chat__title', 'AI Assistant'));
    meta.appendChild(el('div', 'aire-chat__status', 'Online'));
    const spacer = el('div', 'aire-chat__header-spacer');
    const min = el('button', 'aire-chat__min', '–');
    min.setAttribute('aria-label', 'Minimize chat');
    min.addEventListener('click', () => this.close());
    header.append(avatar, meta, spacer, min);

    // Messages.
    const messages = el('div', 'aire-chat__messages');

    // Composer.
    const composer = el('div', 'aire-chat__composer');
    const input = el('textarea', 'aire-chat__input');
    input.rows = 1;
    input.placeholder = 'Type your message…';
    input.addEventListener('input', () => this.autoGrow());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
    const send = el('button', 'aire-chat__send') as HTMLButtonElement;
    send.setAttribute('aria-label', 'Send message');
    send.innerHTML = SEND_SVG;
    send.addEventListener('click', () => this.submit());
    composer.append(input, send);

    panel.append(header, messages, composer);
    this.layer.appendChild(panel);

    this.panel = panel;
    this.messagesEl = messages;
    this.input = input;
    this.sendBtn = send;
  }

  private autoGrow(): void {
    const ta = this.input;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`;
  }

  private submit(): void {
    if (!this.input || this.streaming) return;
    const text = this.input.value.trim();
    if (!text) return;

    this.input.value = '';
    this.autoGrow();

    this.appendBubble('user', text);
    this.history.push({ role: 'user', content: text });

    this.streamReply();
  }

  private streamReply(): void {
    this.setStreaming(true);

    const bubble = this.appendBubble('ai', '');
    const typing = el('div', 'aire-typing');
    typing.append(el('span'), el('span'), el('span'));
    bubble.appendChild(typing);

    let acc = '';
    let started = false;
    let source: ChatSource | null = null;
    let sourceEl: HTMLDivElement | null = null;

    this.abort = this.api.streamChat(this.history, this.getBehaviour(), {
      onToken: (t) => {
        if (!started) {
          started = true;
          bubble.textContent = '';
        }
        acc += t;
        bubble.textContent = acc;
        this.scrollToBottom();
      },
      onSource: (s) => {
        if (sourceEl) return;
        source = s;
        sourceEl = this.appendSource(s);
      },
      onError: (m) => {
        bubble.textContent = acc || m;
      },
      onDone: () => {
        if (!started && !acc) bubble.textContent = 'Sorry, I could not generate a reply.';
        if (acc) this.history.push({ role: 'assistant', content: acc, ...(source ? { source } : {}) });
        this.setStreaming(false);
        this.abort = null;
        this.scrollToBottom();
      },
    });
  }

  private appendBubble(role: 'user' | 'ai', text: string): HTMLDivElement {
    const bubble = el('div', `aire-msg aire-msg--${role}`, text);
    this.messagesEl?.appendChild(bubble);
    this.scrollToBottom();
    return bubble;
  }

  private appendSource(source: ChatSource): HTMLDivElement {
    const wrapper = el('div', 'aire-source');
    wrapper.appendChild(el('div', 'aire-source__label', 'Source'));

    const button = el('button', 'aire-source__button') as HTMLButtonElement;
    button.type = 'button';
    button.setAttribute('aria-label', `Open ${source.title}`);
    button.innerHTML = `${SOURCE_SVG}<span></span>`;
    const label = button.querySelector('span');
    if (label) label.textContent = source.title;
    button.addEventListener('click', () => {
      window.open(source.url, '_blank', 'noopener,noreferrer');
    });

    wrapper.appendChild(button);
    this.messagesEl?.appendChild(wrapper);
    this.scrollToBottom();
    return wrapper;
  }

  private setStreaming(on: boolean): void {
    this.streaming = on;
    if (this.sendBtn) this.sendBtn.disabled = on;
  }

  private scrollToBottom(): void {
    if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}
