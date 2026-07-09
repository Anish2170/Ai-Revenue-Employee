/**
 * Floating chat window with persistent conversations.
 */
import { el } from '../utils/dom.js';
import type { ApiClient } from '../api/client.js';
import type { ChatConversationMeta, ChatMessage, ChatSource, VisitorBehaviour, WidgetConversationResponse } from '../types.js';

export interface ChatAnalyticsCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onMessageSent?: (detail: { length: number }) => void;
  onAiResponseCompleted?: (detail: { length: number }) => void;
  onSourceButtonClicked?: (source: ChatSource) => void;
}

const SEND_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';
const SOURCE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
const CONVERSATION_ID_KEY = 'aire_conversation_id';

function readConversationId(): string | null {
  try { return sessionStorage.getItem(CONVERSATION_ID_KEY); } catch { return null; }
}
function storeConversationId(id: string): void {
  try { sessionStorage.setItem(CONVERSATION_ID_KEY, id); } catch { /* storage may be blocked */ }
}

export class ChatWindow {
  private panel: HTMLDivElement | null = null;
  private messagesEl: HTMLDivElement | null = null;
  private input: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private conversationSelect: HTMLSelectElement | null = null;
  private history: ChatMessage[] = [];
  private conversations: ChatConversationMeta[] = [];
  private conversationId: string | null = readConversationId();
  private pendingAssistant: string | null = null;
  private restored = false;
  private restoring: Promise<void> | null = null;
  private streaming = false;
  private abort: (() => void) | null = null;

  constructor(
    private readonly layer: HTMLElement,
    private readonly api: ApiClient,
    private readonly getBehaviour: () => VisitorBehaviour,
    private readonly onClose: () => void,
    private readonly analytics: ChatAnalyticsCallbacks = {},
  ) {}

  get isOpen(): boolean { return this.panel !== null; }

  restoreLatest(): Promise<void> {
    return this.ensureRestored();
  }

  async open(opener?: string): Promise<void> {
    if (!this.panel) {
      this.render();
      this.analytics.onOpen?.();
    }

    await this.ensureRestored();

    const transition = opener ? this.naturalTransition(opener) : '';
    if (transition) this.seedOpener(transition, true);
    if (this.history.length === 0) this.seedOpener('Hi! I can help answer your questions. What would you like to know?', false);

    requestAnimationFrame(() => this.input?.focus());
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
    this.conversationSelect = null;
    setTimeout(() => panel.remove(), 220);
    this.analytics.onClose?.();
    this.onClose();
  }

  private async ensureRestored(): Promise<void> {
    if (this.restored) return;
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const response = await this.api.restoreConversation(this.getBehaviour(), this.conversationId);
      if (response) this.applyConversationResponse(response);
      this.restored = true;
    })();
    return this.restoring;
  }

  private applyConversationResponse(response: WidgetConversationResponse): void {
    this.conversations = response.conversations;
    this.conversationId = response.conversation.id;
    storeConversationId(response.conversation.id);
    this.history = response.conversation.messages.map((message) => ({ role: message.role, content: message.content, ...(message.source ? { source: message.source } : {}) }));
    this.updateConversationSelect();
    this.renderMessages();
  }

  private render(): void {
    const panel = el('div', 'aire-chat');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with assistant');

    const header = el('div', 'aire-chat__header');
    const avatar = el('div', 'aire-chat__avatar', 'AI');
    const meta = el('div', 'aire-chat__meta');
    meta.appendChild(el('div', 'aire-chat__title', 'AI Assistant'));
    meta.appendChild(el('div', 'aire-chat__status', 'Online'));

    const select = el('select', 'aire-chat__select') as HTMLSelectElement;
    select.setAttribute('aria-label', 'Switch conversation');
    select.addEventListener('change', () => this.switchConversation(select.value));

    const add = el('button', 'aire-chat__new', '+') as HTMLButtonElement;
    add.type = 'button';
    add.setAttribute('aria-label', 'New chat');
    add.addEventListener('click', () => this.newChat());

    const min = el('button', 'aire-chat__min', '-') as HTMLButtonElement;
    min.type = 'button';
    min.setAttribute('aria-label', 'Minimize chat');
    min.addEventListener('click', () => this.close());
    header.append(avatar, meta, select, add, min);

    const messages = el('div', 'aire-chat__messages');
    const composer = el('div', 'aire-chat__composer');
    const input = el('textarea', 'aire-chat__input');
    input.rows = 1;
    input.placeholder = 'Type your message...';
    input.addEventListener('input', () => this.autoGrow());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });
    const send = el('button', 'aire-chat__send') as HTMLButtonElement;
    send.type = 'button';
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
    this.conversationSelect = select;
    this.updateConversationSelect();
    this.renderMessages();
  }

  private updateConversationSelect(): void {
    if (!this.conversationSelect) return;
    this.conversationSelect.innerHTML = '';
    for (const conversation of this.conversations) {
      const option = document.createElement('option');
      option.value = conversation.id;
      option.textContent = conversation.title || 'New Chat';
      option.selected = conversation.id === this.conversationId;
      this.conversationSelect.appendChild(option);
    }
  }

  private renderMessages(): void {
    if (!this.messagesEl) return;
    this.messagesEl.innerHTML = '';
    for (const message of this.history) {
      this.appendBubble(message.role === 'user' ? 'user' : 'ai', message.content);
      if (message.role === 'assistant' && message.source) this.appendSource(message.source);
    }
  }

  private async newChat(): Promise<void> {
    const response = await this.api.createConversation(this.getBehaviour());
    if (response) this.applyConversationResponse(response);
    if (this.history.length === 0) this.seedOpener('Hi! I can help answer your questions. What would you like to know?', false);
    requestAnimationFrame(() => this.input?.focus());
  }

  private async switchConversation(id: string): Promise<void> {
    if (!id || id === this.conversationId || this.streaming) return;
    const response = await this.api.getConversation(id);
    if (response) this.applyConversationResponse(response);
  }

  private naturalTransition(_popupText: string): string {
    return 'Great, I can help with that. What would you like to know first?';
  }

  private seedOpener(opener: string, persist: boolean): void {
    const text = opener.trim();
    if (!text) return;
    const last = this.history[this.history.length - 1];
    if (last && last.role === 'assistant' && last.content === text) return;
    this.history.push({ role: 'assistant', content: text });
    if (persist) this.pendingAssistant = text;
    this.appendBubble('ai', text);
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
    this.analytics.onMessageSent?.({ length: text.length });
    this.streamReply(text);
  }

  private streamReply(userText: string): void {
    this.setStreaming(true);
    const bubble = this.appendBubble('ai', '');
    const typing = el('div', 'aire-typing');
    typing.append(el('span'), el('span'), el('span'));
    bubble.appendChild(typing);

    let acc = '';
    let started = false;
    let source: ChatSource | null = null;
    let sourceEl: HTMLDivElement | null = null;
    const outbound: ChatMessage[] = [
      ...(this.pendingAssistant ? [{ role: 'assistant' as const, content: this.pendingAssistant }] : []),
      { role: 'user', content: userText },
    ];
    this.pendingAssistant = null;

    this.abort = this.api.streamChat(outbound, this.getBehaviour(), this.conversationId, {
      onConversation: (conversation: ChatConversationMeta) => {
        this.conversationId = conversation.id;
        storeConversationId(conversation.id);
        const existing = this.conversations.find((item) => item.id === conversation.id);
        if (existing) Object.assign(existing, conversation);
        else this.conversations.unshift(conversation);
        this.updateConversationSelect();
      },
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
      onError: (m) => { bubble.textContent = acc || m; },
      onDone: () => {
        if (!started && !acc) bubble.textContent = 'Sorry, I could not generate a reply.';
        if (acc) {
          this.history.push({ role: 'assistant', content: acc, ...(source ? { source } : {}) });
          this.analytics.onAiResponseCompleted?.({ length: acc.length });
        }
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
      this.analytics.onSourceButtonClicked?.(source);
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
    if (this.conversationSelect) this.conversationSelect.disabled = on;
  }

  private scrollToBottom(): void {
    if (this.messagesEl) this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }
}