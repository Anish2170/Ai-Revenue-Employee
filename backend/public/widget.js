"use strict";(()=>{function Ye(){var e;return document.currentScript instanceof HTMLScriptElement?document.currentScript:(e=Array.from(document.getElementsByTagName("script")).find(t=>/widget\.js(\?|$)/.test(t.src)))!=null?e:null}function qe(s){try{return new URL(s).origin}catch(e){return window.location.origin}}function be(){var o;let s=Ye(),e=(o=s==null?void 0:s.getAttribute("data-site-id"))!=null?o:"unknown",t=s==null?void 0:s.getAttribute("data-backend"),i=(t!=null?t:s?qe(s.src):window.location.origin).replace(/\/$/,""),n=(s==null?void 0:s.getAttribute("data-debug"))==="true",r=(s==null?void 0:s.getAttribute("data-legacy-engagement"))==="true";return{siteId:e,backendUrl:i,debug:n,legacyEngagement:r}}var C=new Map,R=new Map,O=new Map,M=new Map,we=500;function I(s){return`${s.backendUrl}:${s.siteId}`}function xe(s){return`aire_widget_visitor_v2:${I(s)}`}function D(s){return`aire_widget_session_v2:${I(s)}`}function te(s,e){var t;try{return JSON.parse((t=globalThis[s].getItem(e))!=null?t:"null")}catch(i){return null}}function B(s,e,t){try{globalThis[s].setItem(e,JSON.stringify(t))}catch(i){}}function L(s){if(!s||typeof s!="object")return!1;let e=s;return[e.visitorId,e.visitorToken].every(t=>typeof t=="string"&&t.length>0)&&typeof e.expiresAt=="number"&&Number.isFinite(e.expiresAt)&&e.expiresAt>Date.now()}function ie(s){return L(s)&&typeof s.sessionId=="string"&&s.sessionId.length>0}function Ie(s){if(!s||typeof s!="object")return!1;let e=s,t=Date.now();return ie(e.identity)&&typeof e.identity.returning=="boolean"&&Number.isFinite(e.identity.sessionStartedAt)&&e.identity.sessionStartedAt<=t&&t-e.identity.sessionStartedAt<216e5&&Number.isFinite(e.lastSeenAt)&&e.lastSeenAt<=t&&t-e.lastSeenAt<18e5}async function ke(s,e){var i;let t=I(s);for(let n=0;n<2;n++){let r=C.get(t);if(!r){if(Date.now()<((i=M.get(t))!=null?i:0))return null;r=Ze(s,e),C.set(t,r)}let o=await r.catch(()=>null);if(!o)return C.get(t)===r&&(C.delete(t),R.delete(t),M.set(t,Date.now()+we)),null;let l=o.identity;if(!Ie(o)){L(l)&&O.set(t,l),R.delete(t),C.get(t)===r&&C.delete(t);continue}return R.set(t,o),O.set(t,o.identity),M.delete(t),o.lastSeenAt=Date.now(),B("sessionStorage",D(s),o),o.identity}return M.set(t,Date.now()+we),null}function Ee(){var s;try{return(s=globalThis.navigator)==null?void 0:s.locks}catch(e){return}}async function Se(s,e,t){if(t.aborted)return!1;let i=Ee();if(!i)return!0;let n=()=>{},r=()=>new Promise(o=>{i.request(`aire_widget_tab:${I(s)}:${e}`,{ifAvailable:!0,signal:t},l=>{if(!l){o(!1);return}return o(!0),new Promise(a=>{n=a})}).catch(()=>o(!t.aborted))});return await r()?(t.addEventListener("abort",()=>n(),{once:!0}),window.addEventListener("pagehide",()=>n()),window.addEventListener("pageshow",o=>{o.persisted&&r()}),!0):!1}async function Ze(s,e){let t=new AbortController,i,n=new Promise(o=>{i=window.setTimeout(()=>{t.abort(),o(null)},1e4)}),r=async()=>{let o=Ee();if(o)try{return await o.request(`aire_widget_bootstrap:${I(s)}`,{signal:t.signal},()=>_e(s,e,t.signal))}catch(l){}return _e(s,e,t.signal)};try{return await Promise.race([r(),n])}finally{window.clearTimeout(i)}}async function _e(s,e,t){if(t.aborted)return null;try{let i=te("sessionStorage",D(s));if(Ie(i)&&await Se(s,i.identity.sessionId,t))return i;let n=te("localStorage",xe(s)),r=te("localStorage",`aire_widget_identity:${s.siteId}`),o=i&&typeof i=="object"?i.identity:null,l=O.get(I(s)),a=L(n)?n:ie(r)?r:L(o)?o:L(l)?l:null;a&&O.set(I(s),a);let d=Date.now(),p=await e(`${s.backendUrl}/widget/session`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},signal:t,body:JSON.stringify({siteId:s.siteId,...a?{visitorToken:a.visitorToken}:{}})});if(!p.ok||t.aborted)return null;let c=await p.json();if(t.aborted||!ie(c)||!await Se(s,c.sessionId,t)||t.aborted)return null;let f={identity:{...c,sessionStartedAt:d,returning:(a==null?void 0:a.visitorId)===c.visitorId},lastSeenAt:Date.now()};return B("localStorage",xe(s),{visitorId:c.visitorId,visitorToken:c.visitorToken,expiresAt:c.expiresAt}),B("sessionStorage",D(s),f),f}catch(i){return null}}function H(s,e){let t=R.get(I(s));!t||t.identity.sessionId!==e.sessionId||(t.lastSeenAt=Date.now(),B("sessionStorage",D(s),t))}var Ge=1e4;async function W(s,e={},t=Ge){if(e.signal)return fetch(s,e);let i=new AbortController,n=window.setTimeout(()=>i.abort(),t);try{return await fetch(s,{...e,signal:i.signal})}finally{window.clearTimeout(n)}}var j=class{constructor(e,t,i){this.cfg=e;this.onSessionChange=t;this.onIdentityReady=i;this.sessionId=null}async identity(){var t,i;let e=await ke(this.cfg,W);if(e&&e.sessionId!==this.sessionId){let n=this.sessionId;this.sessionId=e.sessionId,n?(t=this.onSessionChange)==null||t.call(this,e):(i=this.onIdentityReady)==null||i.call(this,e)}return e}getIdentity(){return this.identity()}async postEngage(e,t,i){try{let n=this.sessionId,r=await this.identity();if(!r)return{showPopup:!1};if(n&&n!==r.sessionId)return{showPopup:!1};let o=await W(`${this.cfg.backendUrl}/engage`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},...i!=null&&i.signal?{signal:i.signal}:{},body:JSON.stringify({siteId:this.cfg.siteId,visitorId:r.visitorId,sessionId:r.sessionId,visitorToken:r.visitorToken,behaviour:e,session:t,...i?{lifecycleVersion:2,pageInstanceId:i.page.pageInstanceId,pageStartedAt:i.page.pageStartedAt,clientState:i.clientState}:{}})});return o.ok?await o.json():{showPopup:!1}}catch(n){return{showPopup:!1}}}async restoreConversation(e,t){return this.postConversationEndpoint("/conversations/restore",{behaviour:e,conversationId:t||void 0})}async createConversation(e,t){return this.postConversationEndpoint("/conversations",{behaviour:e,opener:t})}async getConversation(e){try{let t=await this.identity();if(!t)return null;let i=new URLSearchParams({siteId:this.cfg.siteId,visitorId:t.visitorId,visitorToken:t.visitorToken}),n=await W(`${this.cfg.backendUrl}/conversations/${e}?${i.toString()}`,{credentials:"omit"});return n.ok?await n.json():null}catch(t){return null}}async postConversationEndpoint(e,t){try{let i=await this.identity();if(!i)return null;let n=await W(`${this.cfg.backendUrl}${e}`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId:this.cfg.siteId,visitorId:i.visitorId,sessionId:i.sessionId,visitorToken:i.visitorToken,...t})});return n.ok?await n.json():null}catch(i){return null}}streamChat(e,t,i,n){let r=new AbortController;return(async()=>{var o,l,a,d;try{let p=await this.identity();if(!p){n.onError("Unable to start the assistant."),n.onDone();return}let c=await fetch(`${this.cfg.backendUrl}/chat`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:JSON.stringify({siteId:this.cfg.siteId,conversationId:i||void 0,visitorId:p.visitorId,sessionId:p.sessionId,visitorToken:p.visitorToken,messages:e,behaviour:t}),signal:r.signal});if(!c.ok||!c.body){n.onError(c.status===429?"You're doing that a little too quickly. Please try again in a moment.":"The AI is temporarily unavailable. Please try again."),n.onDone();return}let h=c.body.getReader(),f=new TextDecoder,b="";for(;;){let{value:m,done:v}=await h.read();if(v)break;b+=f.decode(m,{stream:!0});let S=b.split(`

`);b=(o=S.pop())!=null?o:"";for(let w of S){let y=w.split(`
`).find(g=>g.startsWith("data:"));if(!y)continue;let _=y.slice(5).trim();if(_==="[DONE]"){n.onDone();return}try{let g=JSON.parse(_);g.error?n.onError(typeof g.error=="string"?g.error.slice(0,500):"The AI is temporarily unavailable. Please try again."):typeof g.leadSaved=="boolean"?(l=n.onLeadSaved)==null||l.call(n,g.leadSaved):g.conversation?(a=n.onConversation)==null||a.call(n,g.conversation):g.token?n.onToken(g.token):g.source&&((d=n.onSource)==null||d.call(n,g.source))}catch(g){}}}n.onDone()}catch(p){(p==null?void 0:p.name)!=="AbortError"&&n.onError("The connection was interrupted. Please try again."),n.onDone()}})(),()=>r.abort()}};var Te="aire_session_v2",se={popupShown:!1,lastEngageAt:null,engageCount:0,dismissed:!1},P=class{constructor(e){this.siteId=e;this.state={...se};this.sessionId=null}bind(e){this.sessionId!==e&&(this.sessionId=e,this.state=this.load(),this.persist())}get(){return{...this.state}}markEngaged(){this.state.engageCount+=1,this.state.lastEngageAt=Date.now(),this.persist()}markPopupShown(){this.state.popupShown=!0,this.persist()}markDismissed(){this.state.dismissed=!0,this.persist()}resetForPage(){this.state.popupShown=!1,this.persist()}load(){try{let e=sessionStorage.getItem(`${Te}:${this.siteId}`);if(e){let t=JSON.parse(e);if(t.sessionId===this.sessionId)return{...se,...t.state,popupShown:!1}}}catch(e){}return{...se}}persist(){try{this.sessionId&&sessionStorage.setItem(`${Te}:${this.siteId}`,JSON.stringify({sessionId:this.sessionId,state:this.state}))}catch(e){}}};var $=class{constructor(){this.pageStart=Date.now();this.maxScrollDepth=0;this.lastActivity=Date.now();this.clicks=[];this.formInteracted=!1;this.exitIntent=!1}reset(){this.pageStart=Date.now(),this.maxScrollDepth=0,this.lastActivity=Date.now(),this.clicks=[],this.formInteracted=!1,this.exitIntent=!1}recordScroll(e){e>this.maxScrollDepth&&(this.maxScrollDepth=Math.min(100,e)),this.markActive()}markActive(){this.lastActivity=Date.now()}recordClick(e){this.markActive(),this.clicks.includes(e)||(this.clicks.push(e),this.clicks.length>20&&this.clicks.shift())}recordFormInteraction(){this.formInteracted=!0,this.markActive()}recordExitIntent(){this.exitIntent=!0}inactiveSeconds(){return(Date.now()-this.lastActivity)/1e3}snapshot(){return{page:window.location.pathname||"/",pageTitle:document.title||"",timeOnPage:Math.round((Date.now()-this.pageStart)/1e3),scrollDepth:Math.round(this.maxScrollDepth),mouseInactive:Math.round(this.inactiveSeconds()),clickedElements:[...this.clicks],formInteracted:this.formInteracted,viewport:{width:window.innerWidth,height:window.innerHeight},exitIntent:this.exitIntent}}};function u(s,e,t){let i=document.createElement(s);return e&&(i.className=e),t!==void 0&&(i.textContent=t),i}function Ce(s){var n;if(!(s instanceof Element))return null;let e=(n=s.closest('[data-track], a, button, [role="button"]'))!=null?n:s;if(!(e instanceof Element))return null;let t=e.getAttribute("data-track")||e.getAttribute("data-testid");if(t)return t.slice(0,80);if(e.id)return`#${e.id}`.slice(0,80);let i=(e.getAttribute("aria-label")||e.textContent||"").trim().replace(/\s+/g," ");return i?`${e.tagName.toLowerCase()}:${i}`.slice(0,80):e.tagName.toLowerCase()}function k(s,e){let t=0,i=null,n;return(...r)=>{n=r;let o=Date.now(),l=e-(o-t);l<=0?(t=o,s(...r)):i||(i=setTimeout(()=>{t=Date.now(),i=null,s(...n)},l))}}function Ae(s,e){let t=null;return(...i)=>{t&&clearTimeout(t),t=setTimeout(()=>s(...i),e)}}function Ke(){let s=document.documentElement,e=s.scrollHeight-window.innerHeight;return e<=0?100:Math.min(100,(window.scrollY||s.scrollTop)/e*100)}function Le(s,e){let t=k(()=>{let a=Ke();s.recordScroll(a),a>=60&&e("scroll")},400),i=k(()=>s.markActive(),1e3),n=a=>{let d=Ce(a.target);d&&(s.recordClick(d),e("click"))},r=a=>{let d=a.target;(d instanceof HTMLInputElement||d instanceof HTMLTextAreaElement||d instanceof HTMLSelectElement)&&(s.recordFormInteraction(),e("form"))},o=a=>{!a.relatedTarget&&a.clientY<=0&&(s.recordExitIntent(),e("exit_intent"))},l=()=>s.markActive();return window.addEventListener("scroll",t,{passive:!0}),window.addEventListener("mousemove",i,{passive:!0}),document.addEventListener("click",n,!0),document.addEventListener("focusin",r,!0),document.addEventListener("input",r,!0),document.addEventListener("keydown",l,{passive:!0}),document.addEventListener("mouseout",o),()=>{window.removeEventListener("scroll",t),window.removeEventListener("mousemove",i),document.removeEventListener("click",n,!0),document.removeEventListener("focusin",r,!0),document.removeEventListener("input",r,!0),document.removeEventListener("keydown",l),document.removeEventListener("mouseout",o)}}var Xe=25,Je=5e3,U=class{constructor(e){this.onMilestone=e;this.buffer=new $;this.detach=null;this.tick=null;this.dwellFired=!1;this.lastPath=window.location.pathname;this.onNavigate=()=>{setTimeout(()=>this.detectNavigation(),0)}}start(){this.detach=Le(this.buffer,e=>this.onMilestone(e)),this.tick=setInterval(()=>{this.detectNavigation();let e=this.buffer.snapshot();!this.dwellFired&&e.timeOnPage>=Xe&&(this.dwellFired=!0,this.onMilestone("dwell"))},Je),window.addEventListener("popstate",this.onNavigate),this.patchHistory()}stop(){var e;(e=this.detach)==null||e.call(this),this.detach=null,this.tick&&clearInterval(this.tick),this.tick=null,window.removeEventListener("popstate",this.onNavigate)}snapshot(){return this.buffer.snapshot()}detectNavigation(){window.location.pathname!==this.lastPath&&(this.lastPath=window.location.pathname,this.buffer.reset(),this.dwellFired=!1,this.onMilestone("navigation"))}patchHistory(){let e=()=>window.dispatchEvent(new Event("popstate")),{pushState:t,replaceState:i}=history;history.pushState=function(...n){let r=t.apply(this,n);return e(),r},history.replaceState=function(...n){let r=i.apply(this,n);return e(),r}}};var Pe=`
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
`;function Me(){let s=document.createElement("div");s.id="ai-revenue-employee",s.style.position="fixed",s.style.zIndex="2147483000",s.style.bottom="0",s.style.right="0",s.setAttribute("aria-live","polite");let e=s.attachShadow({mode:"open"}),t=document.createElement("style");t.textContent=Pe,e.appendChild(t);let i=document.createElement("div");return i.className="aire-layer",e.appendChild(i),document.body.appendChild(s),{shadow:e,layer:i,destroy:()=>s.remove()}}var Qe='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';function Re(s,e,t){var b,m;let i=u("div","aire-popup");i.setAttribute("role","dialog"),i.setAttribute("aria-label","Message from assistant"),e.popupType&&i.setAttribute("data-popup-type",e.popupType),e.tone&&i.setAttribute("data-tone",e.tone);let n=u("button","aire-popup__close","x");n.setAttribute("aria-label","Dismiss");let r=u("div","aire-popup__brand");r.appendChild(u("span","aire-popup__dot")),r.appendChild(u("span",void 0,"AI Assistant"));let o=(b=e.title)==null?void 0:b.trim(),l=((m=e.body)==null?void 0:m.trim())||e.message||"",a=o?u("h3","aire-popup__title",o):null,d=u("p","aire-popup__msg",l),p=e.action?ne(e.action.label,"primary"):e.cta?ne(e.cta,"legacy"):null,c=e.secondaryActionConfig?ne(e.secondaryActionConfig.label,"secondary"):null;if(i.append(n,r),a&&i.appendChild(a),i.appendChild(d),p||c){let v=u("div","aire-popup__actions");p&&v.appendChild(p),c&&v.appendChild(c),i.appendChild(v)}s.appendChild(i);let h=!1,f=(v=!1)=>{if(v){h=!0,i.remove();return}h||(h=!0,i.classList.add("aire-leaving"),setTimeout(()=>i.remove(),240))};return n.addEventListener("click",()=>{t.onDismiss(),f()}),p==null||p.addEventListener("click",()=>{f(!0),t.onCta(e.action)}),c==null||c.addEventListener("click",()=>{f(!0),t.onCta(e.secondaryActionConfig)}),{remove:f}}function ne(s,e){let t=u("button",e==="secondary"?"aire-popup__cta aire-popup__cta--secondary":"aire-popup__cta");t.appendChild(u("span",void 0,s));let i=u("span");return i.innerHTML=Qe,t.appendChild(i),t}function Oe(s){let e=s.normalize("NFKC").toLowerCase();return/\b(no thanks|no thank you|not now|do not email|don't email|no need|nahi chahiye|nahin chahiye|email mat|mat bhej|abhi nahi)\b|(?:ईमेल|इमेल|मेल).{0,20}(?:नहीं|मत)|(?:नहीं चाहिए|अभी नहीं)/iu.test(e)?!1:/\b(best email|email address|what(?:'s| is) your email|what(?:'s| is) the best email|email it|email this|email that|email it to you|email that to you|send .* email|send .* inbox)\b/iu.test(e)||/\b(?:apna|aapka|aapki|aapke|aap|kya|kaunsa|kis|konsa)\b.{0,50}\b(?:email|e-mail)\b.{0,45}\b(?:batayein|bataye|bataiye|batao|dein|dijiye|share|bhej|bhejein|bhejun|address|hai)\b/iu.test(e)||/(?:आप|अपना|आपका|आपकी|कौन|किस|क्या).{0,50}(?:ईमेल|इमेल|e-?mail).{0,45}(?:बताएं|बताइए|दीजिए|दें|भेज|पता|एड्रेस|साझा|है)/iu.test(e)}var et='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>',tt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',it='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>',st='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',nt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',rt=/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,De="aire_conversation_id",ot=["Pricing","Book Demo","Services","Enterprise"];function at(){try{return sessionStorage.getItem(De)}catch(s){return null}}function re(s){try{sessionStorage.setItem(De,s)}catch(e){}}var N=class{constructor(e,t,i,n,r={}){this.layer=e;this.api=t;this.getBehaviour=i;this.onClose=n;this.analytics=r;this.panel=null;this.messagesEl=null;this.input=null;this.sendBtn=null;this.conversationSelect=null;this.history=[];this.conversations=[];this.conversationId=at();this.pendingAssistant=null;this.restored=!1;this.restoring=null;this.streaming=!1;this.abort=null;this.savedLeadCards=new Set;this.responseVersion=0;this.pendingReplyBubble=null}get isOpen(){return this.panel!==null}onNavigation(){var e;this.streaming&&(this.responseVersion++,(e=this.abort)==null||e.call(this),this.abort=null,this.pendingReplyBubble&&(this.pendingReplyBubble.textContent="Page changed. Please ask your question again."),this.pendingReplyBubble=null,this.setStreaming(!1))}restoreLatest(){return this.ensureRestored()}async open(e){var i,n;this.panel||(this.render(),(n=(i=this.analytics).onOpen)==null||n.call(i)),await this.ensureRestored();let t=e?this.naturalTransition(e):"";t&&this.seedOpener(t,!0),this.history.length===0&&(this.seedOpener("Hi! I can help answer your questions. What would you like to know?",!1),this.appendSuggestedQuestions()),requestAnimationFrame(()=>{var r;return(r=this.input)==null?void 0:r.focus()})}close(){var t,i,n;if(!this.panel)return;(t=this.abort)==null||t.call(this);let e=this.panel;e.classList.add("aire-leaving"),this.panel=null,this.messagesEl=null,this.input=null,this.sendBtn=null,this.conversationSelect=null,setTimeout(()=>e.remove(),220),(n=(i=this.analytics).onClose)==null||n.call(i),this.onClose()}async ensureRestored(){if(!this.restored)return this.restoring?this.restoring:(this.restoring=(async()=>{let e=await this.api.restoreConversation(this.getBehaviour(),this.conversationId);e&&this.applyConversationResponse(e),this.restored=!0})(),this.restoring)}applyConversationResponse(e){this.conversations=e.conversations,this.conversationId=e.conversation.id,re(e.conversation.id),this.history=e.conversation.messages.map(t=>{var i;return{role:t.role,content:t.content,...t.source?{source:t.source}:{},...(i=t.sources)!=null&&i.length?{sources:t.sources.slice(0,5)}:{}}}),this.updateConversationSelect(),this.renderMessages()}render(){let e=u("div","aire-chat");e.setAttribute("role","dialog"),e.setAttribute("aria-label","Chat with assistant");let t=u("div","aire-chat__header"),i=u("div","aire-chat__avatar","AI"),n=u("div","aire-chat__meta");n.appendChild(u("div","aire-chat__title","AI Assistant")),n.appendChild(u("div","aire-chat__status","Online"));let r=u("select","aire-chat__select");r.setAttribute("aria-label","Switch conversation"),r.addEventListener("change",()=>this.switchConversation(r.value));let o=u("button","aire-chat__new");o.type="button",o.innerHTML=tt,o.setAttribute("aria-label","New conversation"),o.title="New conversation",o.addEventListener("click",()=>this.newChat());let l=u("button","aire-chat__min");l.type="button",l.innerHTML=it,l.setAttribute("aria-label","Minimize chat"),l.title="Minimize",l.addEventListener("click",()=>this.close());let a=u("button","aire-chat__close");a.type="button",a.innerHTML=st,a.setAttribute("aria-label","Close chat"),a.title="Close",a.addEventListener("click",()=>this.close()),t.append(i,n,r,o,l,a);let d=u("div","aire-chat__messages"),p=u("div","aire-chat__composer"),c=u("textarea","aire-chat__input");c.rows=1,c.placeholder="Ask anything...",c.addEventListener("input",()=>this.autoGrow()),c.addEventListener("keydown",f=>{f.key==="Enter"&&!f.shiftKey&&(f.preventDefault(),this.submit())});let h=u("button","aire-chat__send");h.type="button",h.setAttribute("aria-label","Send message"),h.innerHTML=et,h.addEventListener("click",()=>this.submit()),p.append(c,h),e.append(t,d,p),this.layer.appendChild(e),this.panel=e,this.messagesEl=d,this.input=c,this.sendBtn=h,this.conversationSelect=r,this.updateConversationSelect(),this.renderMessages()}updateConversationSelect(){if(this.conversationSelect){this.conversationSelect.innerHTML="";for(let e of this.conversations){let t=document.createElement("option");t.value=e.id,t.textContent=e.title||"New Chat",t.selected=e.id===this.conversationId,this.conversationSelect.appendChild(t)}}}renderMessages(){var e;if(this.messagesEl){if(this.messagesEl.innerHTML="",!this.restored&&this.history.length===0){this.appendLoadingSkeleton();return}for(let t of this.history){if(this.appendBubble(t.role==="user"?"user":"ai",t.content),t.role==="assistant")for(let i of(e=t.sources)!=null&&e.length?t.sources:t.source?[t.source]:[])this.appendSource(i);t.role==="assistant"&&this.shouldShowLeadCard(t.content)&&this.appendLeadCaptureCard(t.content)}}}async newChat(){let e=await this.api.createConversation(this.getBehaviour());e&&this.applyConversationResponse(e),this.history.length===0&&(this.seedOpener("Hi! I can help answer your questions. What would you like to know?",!1),this.appendSuggestedQuestions()),requestAnimationFrame(()=>{var t;return(t=this.input)==null?void 0:t.focus()})}async switchConversation(e){if(!e||e===this.conversationId||this.streaming)return;let t=await this.api.getConversation(e);t&&this.applyConversationResponse(t)}naturalTransition(e){return this.history.some(t=>t.role==="user")?"":"Great, I can help with that. What would you like to know first?"}seedOpener(e,t){let i=e.trim();if(!i)return;let n=this.history[this.history.length-1];n&&n.role==="assistant"&&n.content===i||(this.history.push({role:"assistant",content:i}),t&&(this.pendingAssistant=i),this.appendBubble("ai",i),this.shouldShowLeadCard(i)&&this.appendLeadCaptureCard(i))}autoGrow(){let e=this.input;e&&(e.style.height="auto",e.style.height=`${Math.min(e.scrollHeight,96)}px`)}submit(){var t,i;if(!this.input||this.streaming)return;let e=this.input.value.trim();e&&(this.input.value="",this.autoGrow(),this.appendBubble("user",e),this.history.push({role:"user",content:e}),(i=(t=this.analytics).onMessageSent)==null||i.call(t,{length:e.length}),this.streamReply(e))}appendLoadingSkeleton(){if(this.messagesEl)for(let e=0;e<3;e+=1){let t=u("div",`aire-skeleton-row ${e===1?"aire-skeleton-row--user":""}`),i=u("div","aire-skeleton-bubble");t.appendChild(i),this.messagesEl.appendChild(t)}}appendSuggestedQuestions(){if(!this.messagesEl||this.messagesEl.querySelector(".aire-suggestions"))return;let e=u("div","aire-suggestions");for(let t of ot){let i=u("button","aire-suggestion-chip",t);i.type="button",i.addEventListener("click",()=>{!this.input||this.streaming||(this.input.value=t,this.autoGrow(),this.submit())}),e.appendChild(i)}this.messagesEl.appendChild(e),this.scrollToBottom()}streamReply(e){this.setStreaming(!0);let t=this.appendBubble("ai",""),i=++this.responseVersion;this.pendingReplyBubble=t;let n=u("div","aire-typing");n.append(u("span"),u("span"),u("span")),t.appendChild(n);let r="",o=!1,l=!1,a=null,d=[],p=this.conversationId?[...this.pendingAssistant?[{role:"assistant",content:this.pendingAssistant}]:[],{role:"user",content:e}]:this.history.slice(-50);this.pendingAssistant=null,this.abort=this.api.streamChat(p,this.getBehaviour(),this.conversationId,{onConversation:c=>{if(i!==this.responseVersion)return;this.conversationId=c.id,re(c.id);let h=this.conversations.find(f=>f.id===c.id);h?Object.assign(h,c):this.conversations.unshift(c),this.updateConversationSelect()},onToken:c=>{i===this.responseVersion&&(o||(o=!0,t.textContent=""),r+=c,t.textContent=r,this.scrollToBottom())},onSource:c=>{i!==this.responseVersion||d.length>=5||d.some(h=>h.url===c.url)||(d.push(c),a!=null||(a=c),this.appendSource(c))},onError:c=>{i===this.responseVersion&&(l=!0,t.textContent=r||c)},onDone:()=>{var c,h;i===this.responseVersion&&(!o&&!r&&!l&&(t.textContent="Sorry, I could not generate a reply."),r&&(this.history.push({role:"assistant",content:r,...a?{source:a,sources:d}:{}}),(h=(c=this.analytics).onAiResponseCompleted)==null||h.call(c,{length:r.length}),this.shouldShowLeadCard(r)&&this.appendLeadCaptureCard(r)),this.setStreaming(!1),this.abort=null,this.pendingReplyBubble=null,this.scrollToBottom())}})}shouldShowLeadCard(e){return Oe(e)}leadCardKey(e){return e.replace(/\s+/g," ").trim().slice(0,160)}appendLeadCaptureCard(e){if(!this.messagesEl)return null;let t=this.leadCardKey(e),i=u("form","aire-lead-card");i.setAttribute("data-lead-key",t),i.noValidate=!0;let n=u("div","aire-lead-card__title","Leave Contact Details"),r=u("span","aire-lead-card__icon","Email");n.prepend(r);let o=u("div","aire-lead-card__subtitle","Share your email for follow-up. This does not send an email or complete a booking."),l=u("label","aire-lead-card__label","Email Address"),a=u("input","aire-lead-card__input");a.type="email",a.placeholder="you@example.com",a.autocomplete="email";let d=u("div","aire-lead-card__error",""),p=u("button","aire-lead-card__button",this.savedLeadCards.has(t)?"Email Saved":"Save");p.type="submit",this.savedLeadCards.has(t)&&(a.disabled=!0,p.disabled=!0,p.classList.add("aire-lead-card__button--saved"));let c=u("button","aire-lead-card__secondary","Maybe Later");return c.type="button",c.addEventListener("click",()=>i.remove()),l.appendChild(a),i.append(n,o,l,d,p,c),i.addEventListener("submit",h=>{h.preventDefault();let f=a.value.trim();if(!rt.test(f)){d.textContent="Please enter a valid email address.",a.setAttribute("aria-invalid","true"),a.focus();return}d.textContent="",a.removeAttribute("aria-invalid"),a.disabled=!0,p.disabled=!0,p.textContent="Saving...",this.submitLeadEmail(f,p,a,t)}),this.messagesEl.appendChild(i),this.scrollToBottom(),i}submitLeadEmail(e,t,i,n){let r=[...this.conversationId?[]:this.history.slice(-49),{role:"user",content:`My email is ${e}`}],o=!1,l=!1,a,d=this.api.streamChat(r,this.getBehaviour(),this.conversationId,{onConversation:p=>{this.conversationId=p.id,re(p.id);let c=this.conversations.find(h=>h.id===p.id);c?Object.assign(c,p):this.conversations.unshift(p),this.updateConversationSelect()},onToken:()=>{},onSource:()=>{},onLeadSaved:p=>{a=p},onError:()=>{o||(l=!0,t.disabled=!1,t.textContent="Try Again",i&&(i.disabled=!1))},onDone:()=>{l||(o=!0,d(),t.textContent=a===!0?"Email Saved":a===!1?"Try Again":"Submitted",a===!0?(n&&this.savedLeadCards.add(n),t.classList.add("aire-lead-card__button--saved")):a===!1&&(t.disabled=!1,i&&(i.disabled=!1)),this.scrollToBottom())}})}appendBubble(e,t){var d,p;let i=(d=this.messagesEl)==null?void 0:d.lastElementChild,n=(i==null?void 0:i.classList.contains("aire-message-row"))&&i.dataset.role===e,r=u("div",`aire-message-row aire-message-row--${e}${n?" aire-message-row--grouped":""}`);r.dataset.role=e,e==="ai"&&r.appendChild(u("div",`aire-message-avatar${n?" aire-message-avatar--hidden":""}`,"AI"));let o=u("div",`aire-msg aire-msg--${e}`,t),l=u("div","aire-msg__time","Now"),a=u("div","aire-message-stack");return a.append(o,l),r.appendChild(a),(p=this.messagesEl)==null||p.appendChild(r),this.scrollToBottom(),o}appendSource(e){var r;let t=u("div","aire-source");t.appendChild(u("div","aire-source__label","Source"));let i=u("button","aire-source__button");i.type="button",i.setAttribute("aria-label",`Open ${e.title}`),i.innerHTML=`${nt}<span></span>`;let n=i.querySelector("span");return n&&(n.textContent=e.title),i.addEventListener("click",()=>{var o,l;(l=(o=this.analytics).onSourceButtonClicked)==null||l.call(o,e),window.open(e.url,"_blank","noopener,noreferrer")}),t.appendChild(i),(r=this.messagesEl)==null||r.appendChild(t),this.scrollToBottom(),t}setStreaming(e){this.streaming=e,this.sendBtn&&(this.sendBtn.disabled=e),this.conversationSelect&&(this.conversationSelect.disabled=e)}scrollToBottom(){this.messagesEl&&(this.messagesEl.scrollTop=this.messagesEl.scrollHeight)}};var lt=[];var He=[{zone:"pricing",re:/(pricing|price|plan|tier|subscri|cost|quote|billing)/i},{zone:"faq",re:/(faq|question|help|support|docs|documentation)/i},{zone:"trust",re:/(testimonial|review|about|team|award|guarantee|trust|case-?study|logos?)/i},{zone:"contact",re:/(contact|book|demo|appointment|schedule|call|email|enquir|inquir)/i},{zone:"product",re:/(product|feature|service|solution|listing|catalog|item)/i},{zone:"cta",re:/(cta|buy|checkout|signup|sign-up|get-started|start|subscribe|add-to-cart|purchase)/i}];function E(s){var i,n;let e=s.tagName.toLowerCase();if(e==="button")return!0;if(e==="a"){let r=(i=s.getAttribute("href"))!=null?i:"";if(/^(tel:|mailto:|https?:\/\/(wa\.me|api\.whatsapp))/i.test(r))return!0}let t=`${s.id} ${s.className} ${(n=s.getAttribute("role"))!=null?n:""}`;return/(cta|btn|button|buy|checkout|signup|get-?started|book|subscribe|add-to-cart)/i.test(t)}function oe(s){var i;let e=s.closest("a");if(!e)return!1;let t=(i=e.getAttribute("href"))!=null?i:"";return/^(tel:|mailto:|https?:\/\/(wa\.me|api\.whatsapp))/i.test(t)}function x(s){var i,n,r,o;if(!s)return Be();for(let l of lt)try{if(s.closest(l.selector))return l.zone}catch(a){}if(E(s))return"cta";let e=s,t=0;for(;e&&t<6;){let l=`${e.id} ${e.className} ${(n=(i=e.getAttribute)==null?void 0:i.call(e,"data-section"))!=null?n:""} ${(o=(r=e.getAttribute)==null?void 0:r.call(e,"aria-label"))!=null?o:""}`;for(let{zone:a,re:d}of He)if(d.test(l))return a;e=e.parentElement,t++}return Be()}function Be(){let s=(typeof window!="undefined"?window.location.pathname:"")||"";for(let{zone:e,re:t}of He)if(t.test(s))return e;return"other"}var pt=12e3,dt=8e3,A=class{constructor(e){this.emit=e;this.zonesSeen=new Set;this.idleTimer=null;this.isIdle=!1;this.formActive=!1;this.formZone="other";this.formStallTimer=null;this.formStalled=!1;this.onFocusIn=e=>{let t=e.target;ae(t)&&(this.markActive(),this.formActive||(this.formActive=!0,this.formStalled=!1,this.formZone=x(t),this.emit("form_start",this.formZone,.8)),this.armFormStall())};this.onInput=e=>{ae(e.target)&&(this.markActive(),this.armFormStall())};this.onFocusOut=e=>{ae(e.target)&&this.formStallTimer&&clearTimeout(this.formStallTimer)}}start(){document.addEventListener("focusin",this.onFocusIn,!0),document.addEventListener("input",this.onInput,!0),document.addEventListener("focusout",this.onFocusOut,!0),this.armIdle(),this.onStart()}stop(){document.removeEventListener("focusin",this.onFocusIn,!0),document.removeEventListener("input",this.onInput,!0),document.removeEventListener("focusout",this.onFocusOut,!0),this.idleTimer&&clearTimeout(this.idleTimer),this.formStallTimer&&clearTimeout(this.formStallTimer),this.onStop()}noteAttention(e,t=.6){this.markActive(),this.zonesSeen.has(e)?this.emit("zone_revisit",e,Math.min(1,t+.1)):this.zonesSeen.add(e),this.emit("content_dwell",e,t),e==="pricing"&&this.emit("pricing_focus",e,Math.min(1,t+.1))}markActive(){this.isIdle&&(this.isIdle=!1,this.emit("resume","other",.5)),this.armIdle()}armIdle(){this.idleTimer&&clearTimeout(this.idleTimer),this.idleTimer=setTimeout(()=>{this.isIdle=!0,this.emit("idle","other",1)},pt)}armFormStall(){this.formStallTimer&&clearTimeout(this.formStallTimer),this.formStalled=!1,this.formStallTimer=setTimeout(()=>{this.formActive&&!this.formStalled&&(this.formStalled=!0,this.emit("form_stall",this.formZone,.8))},dt)}};function ae(s){return s instanceof HTMLInputElement||s instanceof HTMLTextAreaElement||s instanceof HTMLSelectElement}var We=900,ct=60,ut=4e3,V=class extends A{constructor(){super(...arguments);this.surface="desktop";this.hoverZone=null;this.hoverSince=0;this.lastProximityAt=0;this.onMouseMove=k(t=>{this.markActive();let i=document.elementFromPoint(t.clientX,t.clientY),n=x(i);n!==this.hoverZone?(this.settleHover(),this.hoverZone=n,this.hoverSince=Date.now()):this.hoverSince&&Date.now()-this.hoverSince>=We&&(this.noteAttention(n,je(Date.now()-this.hoverSince)),this.hoverSince=0),this.checkProximity(t)},150);this.onMouseOut=t=>{!t.relatedTarget&&t.clientY<=0&&this.emit("exit_signal","other",.8)};this.onClick=t=>{var r;this.markActive();let i=t.target,n=(r=i==null?void 0:i.closest('a,button,[role="button"]'))!=null?r:null;n&&E(n)?this.emit("cta_engage","cta",.9):this.noteAttention(x(i),.6)}}onStart(){window.addEventListener("mousemove",this.onMouseMove,{passive:!0}),document.addEventListener("mouseout",this.onMouseOut),document.addEventListener("click",this.onClick,!0)}onStop(){window.removeEventListener("mousemove",this.onMouseMove),document.removeEventListener("mouseout",this.onMouseOut),document.removeEventListener("click",this.onClick,!0)}checkProximity(t){var d;if(Date.now()-this.lastProximityAt<ut)return;let i=document.elementFromPoint(t.clientX,t.clientY),n=(d=i==null?void 0:i.closest('a,button,[role="button"]'))!=null?d:null;if(!n||!E(n))return;let r=n.getBoundingClientRect(),o=Math.max(r.left-t.clientX,0,t.clientX-r.right),l=Math.max(r.top-t.clientY,0,t.clientY-r.bottom);Math.hypot(o,l)<=ct&&(this.lastProximityAt=Date.now(),this.emit("cta_proximity","cta",.7))}settleHover(){this.hoverZone&&this.hoverSince&&Date.now()-this.hoverSince>=We&&this.noteAttention(this.hoverZone,je(Date.now()-this.hoverSince))}};function je(s){return Math.min(1,.4+s/1e4)}var $e=.5,ht=550,ft=150,gt=400,F=class extends A{constructor(){super(...arguments);this.surface="mobile";this.io=null;this.visible=new Map;this.lastScrollY=0;this.refreshTimer=null;this.onScroll=k(()=>{this.markActive();let t=window.scrollY;this.lastScrollY-t>=gt&&t<200&&this.emit("exit_signal","other",.6),this.lastScrollY=t,this.settleScroll()},120);this.settleScroll=Ae(()=>{let t=null,i=$e;for(let[r,o]of this.visible)o>=i&&(i=o,t=r);if(!t)return;let n=x(t);n!=="other"&&this.noteAttention(n,mt(i))},ht);this.onTouch=()=>this.markActive();this.onTap=t=>{var r;this.markActive();let i=t.target,n=(r=i==null?void 0:i.closest('a,button,[role="button"]'))!=null?r:null;n&&(E(n)||oe(n))?this.emit("cta_engage","cta",oe(n)?1:.9):this.noteAttention(x(i),.6)};this.onBack=()=>{this.emit("exit_signal","other",.7)};this.onHide=()=>{document.visibilityState==="hidden"&&this.emit("exit_signal","other",.6)}}onStart(){this.lastScrollY=window.scrollY,this.io=new IntersectionObserver(t=>this.onIntersect(t),{threshold:[0,$e,1]}),this.observeZones(),this.refreshTimer=setInterval(()=>this.observeZones(),5e3),window.addEventListener("scroll",this.onScroll,{passive:!0}),window.addEventListener("touchstart",this.onTouch,{passive:!0}),window.addEventListener("popstate",this.onBack),document.addEventListener("click",this.onTap,!0),document.addEventListener("visibilitychange",this.onHide,!0)}onStop(){var t;(t=this.io)==null||t.disconnect(),this.io=null,this.refreshTimer&&clearInterval(this.refreshTimer),window.removeEventListener("scroll",this.onScroll),window.removeEventListener("touchstart",this.onTouch),window.removeEventListener("popstate",this.onBack),document.removeEventListener("click",this.onTap,!0),document.removeEventListener("visibilitychange",this.onHide,!0)}observeZones(){if(!this.io)return;let t=document.querySelectorAll("section, header, footer, main, article, [data-section], [id], a, button"),i=0;for(let n of t){if(i>=ft)break;if(this.visible.has(n)){i++;continue}x(n)==="other"&&!E(n)||(this.io.observe(n),this.visible.set(n,0),i++)}}onIntersect(t){for(let i of t)this.visible.set(i.target,i.isIntersecting?i.intersectionRatio:0)}};function mt(s){return Math.min(1,.4+s*.6)}var z=class{constructor(e){this.opts=e;this.buffer=[];this.timer=null;this.stopped=!1;this.lastTs=0;this.emit=(e,t,i=.6)=>{var a,d;if(this.stopped)return;let n=Math.max(0,Math.min(1,i));if(n<.05)return;let r=new Uint8Array(16);crypto.getRandomValues(r),r[6]=r[6]&15|64,r[8]=r[8]&63|128;let o=Array.from(r,p=>p.toString(16).padStart(2,"0")).join(""),l=`${o.slice(0,8)}-${o.slice(8,12)}-${o.slice(12,16)}-${o.slice(16,20)}-${o.slice(20)}`;this.buffer.push({id:l,type:e,zone:t,intensity:n,ts:this.now(),surface:this.opts.surface}),(d=(a=this.opts).log)==null||d.call(a,"[AIRE] emit",e,t,n.toFixed(2)),this.buffer.length>=this.maxBuffer&&this.flush()};this.flushNow=()=>this.flush();this.onVisibility=()=>{document.visibilityState==="hidden"&&this.flush()};var t,i,n;this.start=(t=e.sessionStartedAt)!=null?t:Date.now(),this.flushMs=(i=e.flushMs)!=null?i:4e3,this.maxBuffer=(n=e.maxBuffer)!=null?n:25}begin(){this.timer||(this.timer=setInterval(()=>this.flush(),this.flushMs),window.addEventListener("pagehide",this.flushNow,{capture:!0}),document.addEventListener("visibilitychange",this.onVisibility,{capture:!0}))}stop(){this.stopped=!0,this.timer&&clearInterval(this.timer),this.timer=null,window.removeEventListener("pagehide",this.flushNow,{capture:!0}),document.removeEventListener("visibilitychange",this.onVisibility,{capture:!0}),this.flush()}now(){return this.lastTs=Math.max(this.lastTs,Date.now()-this.start,0),this.lastTs}flush(){if(this.buffer.length===0)return;let e=this.buffer;this.buffer=[];try{this.opts.send(e)}catch(t){}}};function T(){return`${window.location.pathname}${window.location.search}${window.location.hash}`}var Y=class{constructor(e){this.onChange=e;this.key=T();this.started=!1;this.restore=[];this.check=()=>{let e=T();e!==this.key&&(this.key=e,this.onChange())};this.onPageShow=e=>{e.persisted&&(this.key=T(),this.onChange())}}start(){if(!this.started){this.started=!0;for(let e of["pushState","replaceState"]){let t=history[e],i=this,n=function(...r){let o=t.apply(this,r);return i.check(),o};history[e]=n,this.restore.push(()=>{history[e]===n&&(history[e]=t)})}window.addEventListener("popstate",this.check),window.addEventListener("hashchange",this.check),window.addEventListener("pageshow",this.onPageShow)}}stop(){this.started=!1;for(let e of this.restore.splice(0).reverse())e();window.removeEventListener("popstate",this.check),window.removeEventListener("hashchange",this.check),window.removeEventListener("pageshow",this.onPageShow)}};function vt(){let s=typeof window.matchMedia=="function"&&window.matchMedia("(pointer: coarse)").matches,e=window.innerWidth<768;return s&&e?"mobile":s&&!e?"tablet":"desktop"}var q=class{constructor(e){this.opts=e;this.adapter=null;this.emitter=null;this.surface=vt();this.stopped=!1;this.pending=new Set;this.sessionId=e.identity.sessionId,this.visitorId=e.identity.visitorId,this.visitorToken=e.identity.visitorToken,this.returning=e.identity.returning}cancelPending(){let e=this.pending.size>0;for(let t of this.pending)t.abort();return this.pending.clear(),e}requestOpportunity(){var e,t;this.stopped||(e=this.opts.getClientState().safety)!=null&&e.blockedReason||(t=this.emitter)==null||t.emit("resume","other",.5)}start(){this.adapter||(this.stopped=!1,this.emitter=new z({surface:this.surface,sessionStartedAt:this.opts.identity.sessionStartedAt,send:e=>this.send(e),log:this.opts.debug?(...e)=>console.log(...e):void 0}),this.adapter=this.surface==="mobile"?new F(this.emitter.emit):new V(this.emitter.emit),this.emitter.begin(),this.adapter.start(),this.opts.debug&&console.log("[AIRE popup-trace] stage=1_widget_event_collection sensors_started",{surface:this.surface,returning:this.returning,sessionId:this.sessionId.slice(0,8)}))}stop(){var e,t;this.stopped=!0,this.cancelPending(),(e=this.adapter)==null||e.stop(),this.adapter=null,(t=this.emitter)==null||t.stop(),this.emitter=null}async send(e){var a,d,p,c;if(this.stopped)return;let t=T(),i=(d=(a=this.opts).getPageContext)==null?void 0:d.call(a),n;try{n=await this.opts.getIdentity()}catch(h){return}if(this.stopped||(n==null?void 0:n.sessionId)!==this.sessionId||T()!==t||i&&((c=(p=this.opts).getPageContext)==null?void 0:c.call(p).version)!==i.version)return;H(this.opts,this.opts.identity),this.opts.debug&&console.log("[AIRE popup-trace] stage=1_widget_event_collection sending_batch",{passed:e.length>0,eventCount:e.length,events:e.map(h=>({type:h.type,zone:h.zone,intensity:h.intensity,ts:h.ts})),clientState:this.opts.getClientState()});let r=JSON.stringify({...i?{lifecycleVersion:2,pageInstanceId:i.pageInstanceId,pageStartedAt:i.pageStartedAt}:{},siteId:this.opts.siteId,visitorToken:this.visitorToken,sessionId:this.sessionId,visitorId:this.visitorId,returning:this.returning,surface:this.surface,pageUrl:window.location.href,pagePath:window.location.pathname||"/",pageTitle:document.title||"",referrer:document.referrer||void 0,device:wt(),browser:xt(),clientState:this.opts.getClientState(),events:e,botSignal:{webdriver:bt()}});if(this.pending.size>=2)return;let o=new AbortController;this.pending.add(o);let l=window.setTimeout(()=>o.abort(),13e3);fetch(`${this.opts.backendUrl}/events`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:r,keepalive:!0,signal:o.signal}).then(async h=>{var v,S;if(!h.ok)return;let f=await h.json().catch(()=>null),b=f==null?void 0:f.popup,m=(S=(v=this.opts).getPageContext)==null?void 0:S.call(v);!o.signal.aborted&&!this.stopped&&T()===t&&(!i||(m==null?void 0:m.pageInstanceId)===i.pageInstanceId&&m.version===i.version&&!m.blockedReason)&&yt(b)&&this.opts.onPopup(b)}).catch(()=>{}).finally(()=>{window.clearTimeout(l),this.pending.delete(o)})}};function yt(s){if(!s||typeof s!="object")return!1;let e=s;return typeof e.title=="string"&&typeof e.body=="string"&&typeof e.popupType=="string"&&typeof e.tone=="string"&&(e.delivery===void 0||e.delivery.version===2&&typeof e.delivery.popupId=="string"&&e.delivery.decisionId===e.delivery.popupId&&typeof e.delivery.pageInstanceId=="string"&&Number.isFinite(e.delivery.expiresAt)&&Number.isInteger(e.delivery.contextVersion)&&typeof e.delivery.formAssistance=="boolean")&&(e.cta===void 0||typeof e.cta=="string")&&(e.primaryAction===void 0||typeof e.primaryAction=="string")&&(e.secondaryAction===void 0||typeof e.secondaryAction=="string")&&(e.action===void 0||Ue(e.action))&&(e.secondaryActionConfig===void 0||Ue(e.secondaryActionConfig))}function Ue(s){if(!s||typeof s!="object")return!1;let e=s;return typeof e.actionId=="string"&&typeof e.label=="string"&&typeof e.destinationType=="string"&&typeof e.destination=="string"&&typeof e.enabled=="boolean"}function bt(){return navigator.webdriver===!0}function wt(){let s=navigator.userAgent.toLowerCase();return/ipad|tablet/.test(s)?"tablet":/mobi|android|iphone/.test(s)?"mobile":"desktop"}function xt(){let s=navigator.userAgent;return/Edg\//.test(s)?"Edge":/Chrome\//.test(s)&&!/Chromium\//.test(s)?"Chrome":/Safari\//.test(s)&&!/Chrome\//.test(s)?"Safari":/Firefox\//.test(s)?"Firefox":"Other"}var St=5e3,Ne=50,Ve=2,_t=[500,1500],It=5e3,Z=class{constructor(e,t){this.cfg=e;this.identity=t;this.device=At();this.browser=Lt();this.surface=Ct();this.sessionStartedAt=Date.now();this.pageStartedAt=Date.now();this.pageKey=this.currentPageKey();this.buffer=[];this.flushing=!1;this.retryTimer=null;this.timer=null;this.stopped=!1;this.sessionEnded=!1;this.restoreHistory=[];this.endSession=()=>{if(this.sessionEnded){this.flush(!0);return}this.sessionEnded=!0,this.trackPageEnd(),this.track("VISITOR","session_ended",{durationMs:Date.now()-this.sessionStartedAt,flush:!0}),this.flush(!0)};this.onVisibility=()=>{document.visibilityState==="hidden"&&this.endSession()};this.onNavigation=()=>{setTimeout(()=>{let e=this.currentPageKey();e!==this.pageKey&&(this.trackPageEnd(),this.pageStartedAt=Date.now(),this.pageKey=e,this.track("PAGE","page_viewed",{flush:!0}))},0)};this.visitorId=t.visitorId,this.sessionId=t.sessionId,this.visitorToken=t.visitorToken,this.returning=t.returning}start(){this.timer||(this.timer=setInterval(()=>this.flush(),St),window.addEventListener("pagehide",this.endSession,{capture:!0}),document.addEventListener("visibilitychange",this.onVisibility,{capture:!0}),window.addEventListener("popstate",this.onNavigation,{capture:!0}),this.patchHistory("pushState"),this.patchHistory("replaceState"),this.track("WIDGET","widget_loaded"),this.track("VISITOR","visitor_started"),this.returning&&this.track("VISITOR","returning_visitor"),this.track("VISITOR","session_started"),this.track("PAGE","page_viewed",{flush:!0}))}stop(){if(!this.stopped){this.stopped=!0,this.timer&&clearInterval(this.timer),this.timer=null;for(let e of this.restoreHistory.splice(0))e();window.removeEventListener("pagehide",this.endSession,{capture:!0}),document.removeEventListener("visibilitychange",this.onVisibility,{capture:!0}),window.removeEventListener("popstate",this.onNavigation,{capture:!0}),this.endSession()}}track(e,t,i={}){if(this.stopped&&t!=="session_ended")return;let n={eventId:Et(),category:e,eventName:t,occurredAt:new Date().toISOString(),...this.pageContext(),device:this.device,browser:this.browser,surface:this.surface,...Tt(i)};this.buffer.push(n),(i.flush||this.buffer.length>=Ne)&&this.flush()}trackPageEnd(){this.track("PAGE","page_exited",{durationMs:Date.now()-this.pageStartedAt,flush:!0})}patchHistory(e){let t=history,i=`__aireAnalytics_${e}`;if(t[i])return;t[i]=!0;let n=history[e],r=this,o=function(...a){let d=n.apply(this,a);return r.onNavigation(),d};history[e]=o,this.restoreHistory.push(()=>{history[e]===o&&(history[e]=n,delete t[i])})}flush(e=!1){if(this.buffer.length===0||this.flushing)return;if(e){let i=this.buffer.splice(0,this.buffer.length),n=this.payloadFor(i);if(typeof navigator.sendBeacon=="function"&&navigator.sendBeacon(`${this.cfg.backendUrl}/analytics/events`,new Blob([n],{type:"application/json"})))return;this.buffer.unshift(...i)}this.flushing=!0;let t=this.buffer.splice(0,Math.min(this.buffer.length,Ne));this.send(t,0).finally(()=>{this.flushing=!1,this.buffer.length>0&&!this.retryTimer&&this.flush()})}payloadFor(e){return H(this.cfg,this.identity),JSON.stringify({siteId:this.cfg.siteId,visitorToken:this.visitorToken,visitorId:this.visitorId,sessionId:this.sessionId,returning:this.returning,...this.pageContext(),device:this.device,browser:this.browser,surface:this.surface,events:e})}async send(e,t){let i=new AbortController,n=setTimeout(()=>i.abort(),It);try{let r=await fetch(`${this.cfg.backendUrl}/analytics/events`,{method:"POST",credentials:"omit",headers:{"Content-Type":"application/json"},body:this.payloadFor(e),keepalive:!0,signal:i.signal});if(r.ok||!kt(r.status,t))return;throw new Error(`analytics_http_${r.status}`)}catch(r){if(t>=Ve||this.stopped)return;this.retryTimer=setTimeout(()=>{this.retryTimer=null,this.send(e,t+1).finally(()=>{this.buffer.length>0&&!this.retryTimer&&this.flush()})},_t[t])}finally{clearTimeout(n)}}pageContext(){return{pageUrl:window.location.href,pagePath:window.location.pathname||"/",pageTitle:document.title||"",referrer:document.referrer||void 0}}currentPageKey(){return`${window.location.pathname}${window.location.search}${window.location.hash}`}};function kt(s,e){return s>=500&&s<=599&&e<Ve}function Et(){if(typeof crypto!="undefined"&&typeof crypto.randomUUID=="function")return crypto.randomUUID();let s=new Uint8Array(16);crypto.getRandomValues(s),s[6]=s[6]&15|64,s[8]=s[8]&63|128;let e=Array.from(s,t=>t.toString(16).padStart(2,"0")).join("");return`${e.slice(0,8)}-${e.slice(8,12)}-${e.slice(12,16)}-${e.slice(16,20)}-${e.slice(20)}`}function Tt(s){let{flush:e,...t}=s;return t}function Ct(){let s=typeof window.matchMedia=="function"&&window.matchMedia("(pointer: coarse)").matches;return s&&window.innerWidth<768?"mobile":s?"tablet":"desktop"}function At(){let s=navigator.userAgent.toLowerCase();return/ipad|tablet/.test(s)?"tablet":/mobi|android|iphone/.test(s)?"mobile":"desktop"}function Lt(){let s=navigator.userAgent;return/Edg\//.test(s)?"Edge":/Chrome\//.test(s)&&!/Chromium\//.test(s)?"Chrome":/Safari\//.test(s)&&!/Chrome\//.test(s)?"Safari":/Firefox\//.test(s)?"Firefox":"Other"}var K=class{constructor(e=()=>{}){this.onChange=e;this.version=0;this.lastActivity=Date.now();this.lastInput=0;this.focusedAt=0;this.composing=!1;this.submitting=!1;this.converted=!1;this.chatOpen=!1;this.stableAt=Date.now()+1e3;this.timer=null;this.signature="";this.started=!1;this.onEvent=e=>{var i,n,r,o,l;let t=(n=(i=e.composedPath)==null?void 0:i.call(e)[0])!=null?n:e.target;if(!((r=t==null?void 0:t.closest)!=null&&r.call(t,"#ai-revenue-employee")||((o=e.target)==null?void 0:o.id)==="ai-revenue-employee")){if(e.type==="aire:conversion"){let a=(l=e.detail)==null?void 0:l.status;a==="success"&&(this.converted=!0),this.submitting=a==="in_progress",this.invalidate();return}if(e.type==="visibilitychange"){this.invalidate();return}if(this.lastActivity=Date.now(),e.type==="submit"){this.submitting=!0,this.invalidate();return}if(e.type==="focusin"&&G(t)&&(this.focusedAt=Date.now()),e.type==="compositionstart"&&(this.composing=!0),e.type==="compositionend"&&(this.composing=!1),(e.type==="input"||e.type==="change"||e.type.startsWith("composition")||e.type==="keydown")&&G(t)&&(this.lastInput=Date.now()),["input","change","focusin","focusout","compositionstart","compositionend"].includes(e.type)||e.type==="keydown"&&G(t))this.invalidate();else{let a=this.version,d=this.snapshot();a!==d.version&&this.onChange(d),this.schedule()}}}}start(){if(!this.started){this.started=!0;for(let e of["pointerdown","pointermove","touchstart","scroll","keydown","focusin","focusout","input","change","compositionstart","compositionend","submit","visibilitychange","aire:conversion"])document.addEventListener(e,this.onEvent,!0);this.schedule()}}stop(){this.started=!1;for(let e of["pointerdown","pointermove","touchstart","scroll","keydown","focusin","focusout","input","change","compositionstart","compositionend","submit","visibilitychange","aire:conversion"])document.removeEventListener(e,this.onEvent,!0);this.timer!==null&&window.clearTimeout(this.timer)}navigate(){this.stableAt=Date.now()+1e3,this.lastActivity=Date.now(),this.lastInput=0,this.focusedAt=0,this.composing=!1,this.submitting=!1,this.invalidate()}renewSession(){this.converted=!1,this.submitting=!1,this.navigate()}setChatOpen(e){this.chatOpen!==e&&(this.chatOpen=e,this.invalidate())}snapshot(){let e=Date.now(),t=Pt(),i=G(t),n=e-Math.max(this.lastInput,this.focusedAt),r=i&&!this.composing&&this.focusedAt>0&&n>=8e3&&n<3e4,o=null;this.converted||/(?:^|\/)(?:thank-you|thankyou|order-confirmation|booking-confirmed)(?:\/|$)/i.test(window.location.pathname)?o="converted":this.chatOpen?o="chat_open":document.visibilityState==="hidden"?o="hidden":this.submitting?o="conversion_in_progress":e<this.stableAt||document.readyState==="loading"?o="page_unstable":Mt(t)?o="critical_interaction":this.composing||this.lastInput>0&&e-this.lastInput<2e3?o="typing":i&&!r?o=n>=3e4?"idle":"form_progress":!r&&e-this.lastActivity>=12e3&&(o="idle");let l=`${o!=null?o:"safe"}:${r}`;return this.signature&&l!==this.signature&&this.version++,this.signature=l,{blockedReason:o,version:this.version,formStalled:r}}invalidate(){this.version++;let e=this.snapshot();this.started&&this.onChange(e),this.schedule()}schedule(){if(!this.started)return;this.timer!==null&&window.clearTimeout(this.timer);let e=Date.now(),t=[this.stableAt,this.lastInput+2e3,this.lastActivity+12e3,Math.max(this.focusedAt,this.lastInput)+8e3,Math.max(this.focusedAt,this.lastInput)+3e4].filter(i=>i>e);if(!t.length){this.timer=null;return}this.timer=window.setTimeout(()=>{this.timer=null;let i=this.version,n=this.snapshot();i!==n.version&&this.onChange(n),this.schedule()},Math.max(1,Math.min(...t)-e))}};function Pt(){var e;let s=document.activeElement;for(;(e=s==null?void 0:s.shadowRoot)!=null&&e.activeElement;)s=s.shadowRoot.activeElement;return s}function G(s){var e;return!!((e=s==null?void 0:s.matches)!=null&&e.call(s,"input:not([type=button]):not([type=submit]):not([type=hidden]),textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=combobox]"))}function Mt(s){var t,i,n,r;if(/(?:^|\/)(?:checkout|payment|pay)(?:\/|$)/i.test(window.location.pathname)||(t=s==null?void 0:s.matches)!=null&&t.call(s,'iframe,input[type=password],input[autocomplete^="cc-"]')||(i=s==null?void 0:s.closest)!=null&&i.call(s,'[data-aire-critical],form[action*="checkout"],form[action*="payment"]'))return!0;let e=(r=(n=document.querySelectorAll)==null?void 0:n.call(document,'dialog[open],[aria-modal=true],[data-aire-critical="active"]'))!=null?r:[];return Array.from(e).some(o=>!o.closest("#ai-revenue-employee")&&!o.hasAttribute("hidden")&&o.getAttribute("aria-hidden")!=="true"&&o.getClientRects().length>0)}var X=class{constructor(e){this.cfg=e;this.receipts=[];this.flushing=!1;this.loaded=!1;this.retryAt=0}get key(){return`aire-popup-receipts:${this.cfg.siteId}`}resume(e){var t;if(!this.loaded){this.loaded=!0;try{let i=JSON.parse((t=sessionStorage.getItem(this.key))!=null?t:"[]");Array.isArray(i)&&(this.receipts=i.slice(0,12).filter(n=>{var r,o;return!!(n&&["displayed","release","clicked","dismissed"].includes(n.operation)&&typeof n.popupId=="string"&&typeof n.pageInstanceId=="string"&&((r=n.identity)==null?void 0:r.sessionId)===e.sessionId&&((o=n.identity)==null?void 0:o.visitorToken)===e.visitorToken)}).map(n=>({...n,attempts:0})))}catch(i){}}if(this.receipts=this.receipts.filter(i=>i.identity.sessionId===e.sessionId||i.attempts<3),!this.flushing&&Date.now()>=this.retryAt){this.retryAt=Date.now()+5e3;for(let i of this.receipts)i.identity.sessionId===e.sessionId&&(i.attempts=0)}this.persist(),this.flush()}async claim(e,t,i,n){try{let r=await this.request({operation:"claim",popupId:e.popupId,pageInstanceId:e.pageInstanceId,context:i},t,n);return r!=null&&r.ok&&typeof r.claimUntil=="number"?r.claimUntil:null}catch(r){return null}}context(e,t){this.request({operation:"context",pageInstanceId:t.pageInstanceId,context:t},e).catch(()=>{})}notify(e,t,i){this.receipts.some(n=>n.popupId===t.popupId&&n.operation===e)||this.receipts.length>=12||(this.receipts.push({operation:e,popupId:t.popupId,pageInstanceId:t.pageInstanceId,identity:i,attempts:0}),this.persist(),this.flush())}persist(){try{sessionStorage.setItem(this.key,JSON.stringify(this.receipts))}catch(e){}}async flush(){if(!this.flushing){this.flushing=!0;try{for(;;){let e=this.receipts.find((t,i)=>t.attempts<3&&!this.receipts.slice(0,i).some(n=>n.popupId===t.popupId));if(!e)return;e.attempts++;try{if(!await this.request({operation:e.operation,popupId:e.popupId,pageInstanceId:e.pageInstanceId},e.identity))throw new Error("Receipt unavailable");this.receipts=this.receipts.filter(i=>i!==e)}catch(t){e.attempts<3&&await new Promise(i=>window.setTimeout(i,e.attempts===1?500:1500))}this.persist()}}finally{this.flushing=!1}}}async request(e,t,i){let n=new AbortController,r=()=>n.abort();i!=null&&i.aborted?n.abort():i==null||i.addEventListener("abort",r,{once:!0});let o=null;try{let l=new Promise((d,p)=>{o=window.setTimeout(()=>{n.abort(),p(new Error("Popup receipt timeout"))},4e3)}),a=(async()=>{if(n.signal.aborted)return null;let d=await fetch(`${this.cfg.backendUrl}/popup/lifecycle`,{method:"POST",credentials:"omit",keepalive:!0,signal:n.signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({...e,siteId:this.cfg.siteId,visitorId:t.visitorId,sessionId:t.sessionId,visitorToken:t.visitorToken})});if(!d.ok){if(d.status===400||d.status===403)return{ok:!1};throw new Error("Lifecycle unavailable")}let p=await d.json();return n.signal.aborted?null:p})();return await Promise.race([a,l])}finally{o!==null&&window.clearTimeout(o),i==null||i.removeEventListener("abort",r)}}};function J(){let s=crypto.getRandomValues(new Uint8Array(16));s[6]=s[6]&15|64,s[8]=s[8]&63|128;let e=Array.from(s,t=>t.toString(16).padStart(2,"0")).join("");return`${e.slice(0,8)}-${e.slice(8,12)}-${e.slice(12,16)}-${e.slice(16,20)}-${e.slice(20)}`}var Q=25e3,Fe=2,Rt='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z"/></svg>',ee=class{constructor(e){this.cfg=e;this.root=null;this.api=null;this.session=null;this.tracker=null;this.chat=null;this.popup=null;this.launcher=null;this.evaluating=!1;this.sensors=null;this.analytics=null;this.sessionId=null;this.identity=null;this.started=!1;this.publicStartPromise=null;this.startupRetries=0;this.recoveryTimer=null;this.navigationTimer=null;this.pageVersion=0;this.pageInstanceId=J();this.pageStartedAt=0;this.acceptingPopup=!1;this.legacyRequest=null;this.legacyRetryAt=0;this.contextTimer=null;this.delivery=new X(this.cfg);this.safety=new K(()=>this.onSafetyChange());this.navigation=new Y(()=>this.onNavigation());this.recoverTransports=()=>{document.visibilityState!=="hidden"&&(this.identity&&this.delivery.resume(this.identity),!this.sensors&&(this.startupRetries=0,this.startPublicTransports()))}}start(){this.started||(this.started=!0,this.mountUiShell(),this.safety.start(),this.navigation.start(),window.addEventListener("online",this.recoverTransports),document.addEventListener("visibilitychange",this.recoverTransports),this.startPublicTransports())}startPublicTransports(){return this.publicStartPromise?this.publicStartPromise:(this.publicStartPromise=(async()=>{var e;try{let t=await((e=this.api)==null?void 0:e.getIdentity());t?this.activateIdentity(t):this.scheduleRecovery()}catch(t){this.scheduleRecovery()}})().finally(()=>{this.publicStartPromise=null}),this.publicStartPromise)}activateIdentity(e){this.recoveryTimer!==null&&window.clearTimeout(this.recoveryTimer),this.recoveryTimer=null,this.startupRetries=0,this.sessionId!==e.sessionId&&this.renewSession(e),this.cfg.legacyEngagement&&this.startLegacyEngagement()}scheduleRecovery(){if(this.recoveryTimer!==null||this.startupRetries>=3)return;let e=500*2**this.startupRetries++;this.recoveryTimer=window.setTimeout(()=>{this.recoveryTimer=null,this.startPublicTransports()},e)}onNavigation(){var t,i,n,r,o;let e=++this.pageVersion;(t=this.chat)==null||t.onNavigation(),this.pageInstanceId=J(),this.pageStartedAt=Math.max(this.pageStartedAt+1,Math.max(0,Date.now()-((n=(i=this.identity)==null?void 0:i.sessionStartedAt)!=null?n:Date.now()))),this.safety.navigate(),(r=this.sensors)==null||r.stop(),this.sensors=null,this.dismissPopup(),(o=this.session)==null||o.resetForPage(),this.navigationTimer!==null&&window.clearTimeout(this.navigationTimer),this.navigationTimer=window.setTimeout(()=>{this.navigationTimer=null,e===this.pageVersion&&this.identity&&!this.sensors&&this.startSensors(this.identity)},0)}startAnalytics(e){if(!this.analytics)try{this.analytics=new Z(this.cfg,e),this.analytics.start()}catch(t){this.analytics=null,this.log("analytics failed to start (non-fatal)",t)}}renewSession(e){var t,i,n;this.identity=e,this.sessionId=e.sessionId,this.legacyRetryAt=0,this.pageInstanceId=J(),this.pageStartedAt=Math.max(0,Date.now()-e.sessionStartedAt),this.safety.renewSession(),this.delivery.resume(e),(t=this.sensors)==null||t.stop(),this.sensors=null,(i=this.analytics)==null||i.stop(),this.analytics=null,this.dismissPopup(),(n=this.session)==null||n.bind(e.sessionId),this.startAnalytics(e),this.startSensors(e)}mountUiShell(){var e;this.root||(this.root=Me(),this.api=new j(this.cfg,t=>this.activateIdentity(t),t=>this.activateIdentity(t)),this.session=(e=this.session)!=null?e:new P(this.cfg.siteId),this.chat=new N(this.root.layer,this.api,()=>this.currentBehaviourSnapshot(),()=>this.showLauncher(),{onOpen:()=>{var t;this.dismissPopup(),this.safety.setChatOpen(!0),(t=this.analytics)==null||t.track("CHAT","chat_opened",{flush:!0})},onClose:()=>{var t;this.safety.setChatOpen(!1),(t=this.analytics)==null||t.track("CHAT","chat_closed")},onMessageSent:t=>{var i;return(i=this.analytics)==null?void 0:i.track("CHAT","message_sent",{numericValue:t.length,flush:!0})},onAiResponseCompleted:t=>{var i;return(i=this.analytics)==null?void 0:i.track("CHAT","ai_response_completed",{numericValue:t.length,flush:!0})},onSourceButtonClicked:t=>{var i;return(i=this.analytics)==null?void 0:i.track("CHAT","source_button_clicked",{sourceTitle:t.title,sourceUrl:t.url,flush:!0})}}),this.chat.restoreLatest(),this.showLauncher())}currentBehaviourSnapshot(){var t,i;return{...(i=(t=this.tracker)==null?void 0:t.snapshot())!=null?i:{page:window.location.pathname||"/",pageTitle:document.title||"",timeOnPage:0,scrollDepth:0,mouseInactive:0,clickedElements:[],formInteracted:!1,viewport:{width:window.innerWidth,height:window.innerHeight},exitIntent:!1},page:(window.location.pathname||"/")+(window.location.search||""),pageTitle:document.title||""}}startSensors(e){try{this.sensors=new q({siteId:this.cfg.siteId,backendUrl:this.cfg.backendUrl,identity:e,getIdentity:()=>this.api.getIdentity(),debug:this.cfg.debug,getClientState:()=>this.eventsClientState(),getPageContext:()=>this.popupPageContext(),onPopup:t=>{this.onPipelinePopup(t)}}),this.sensors.start()}catch(t){this.sensors=null,this.log("sensor engine failed to start (non-fatal)",t)}}startLegacyEngagement(){var e;this.tracker||(this.mountUiShell(),this.session=(e=this.session)!=null?e:new P(this.cfg.siteId),this.tracker=new U(t=>this.onMilestone(t)),this.tracker.start(),this.log("legacy engagement enabled"))}onMilestone(e){this.session&&e!=="navigation"&&this.tryEngage(e)}async tryEngage(e){let t=this.session,i=this.api,n=this.tracker,r=this.chat;if(!t||!i||!n||!r)return;let o=t.get(),l=this.sessionId,a=this.pageVersion;if(this.evaluating||r.isOpen||this.popup||Date.now()<this.legacyRetryAt||o.popupShown||o.dismissed||this.safety.snapshot().blockedReason||this.safety.snapshot().formStalled||o.lastEngageAt&&Date.now()-o.lastEngageAt<Q)return;this.evaluating=!0,this.legacyRetryAt=Date.now()+Q;let d=n.snapshot(),p=new AbortController;this.legacyRequest=p;let c=window.setTimeout(()=>p.abort(),13e3),h=await i.postEngage(d,o,{page:this.popupPageContext(),clientState:this.eventsClientState(),signal:p.signal});window.clearTimeout(c),this.legacyRequest=null,this.evaluating=!1,!(l!==this.sessionId||a!==this.pageVersion)&&(this.log(`engage (${e}) ->`,h),h.showPopup&&await this.onPipelinePopup(h))}async onPipelinePopup(e){let t=e.delivery,i=this.identity;if(!t||!i||this.acceptingPopup)return;let n=()=>{var r,o,l,a,d,p;return((r=this.identity)==null?void 0:r.sessionId)===i.sessionId&&this.pageInstanceId===t.pageInstanceId&&Date.now()<t.expiresAt&&this.safety.snapshot().version===t.contextVersion&&!this.safety.snapshot().blockedReason&&this.safety.snapshot().formStalled===t.formAssistance&&!((o=this.chat)!=null&&o.isOpen)&&!this.popup&&!((l=this.session)!=null&&l.get().dismissed)&&!((a=this.session)!=null&&a.get().popupShown)&&((p=(d=this.session)==null?void 0:d.get().engageCount)!=null?p:0)<Fe};if(!n()){this.delivery.notify("release",t,i);return}this.acceptingPopup=!0;try{let r=await this.delivery.claim(t,i,this.popupPageContext());if(!r||Date.now()>=r||!n()){this.delivery.notify("release",t,i);return}let o={showPopup:!0,title:e.title,body:e.body,message:e.body,cta:e.cta,primaryAction:e.primaryAction,secondaryAction:e.secondaryAction,action:e.action,secondaryActionConfig:e.secondaryActionConfig,popupType:e.popupType,tone:e.tone,ctaUrl:"ctaUrl"in e?e.ctaUrl:void 0,delivery:t};this.log("[popup-trace] stage=9_popup_delivery_to_widget artifact_received",{passed:!0,popupGenerated:!0,popupType:e.popupType}),this.showPopup(o)||this.delivery.notify("release",t,i)}catch(r){this.delivery.notify("release",t,i)}finally{this.acceptingPopup=!1}}showPopup(e){var a,d,p,c,h,f,b,m,v,S;let t=this.root,i=this.session,n=this.chat;if(!t||!i||!n)return this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:"ui_not_ready",popupGenerated:!1}),!1;let r=i.get(),o=this.safety.snapshot();if(o.blockedReason||o.formStalled&&!((a=e.delivery)!=null&&a.formAssistance))return!1;if(!e.showPopup)return this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:"decision_showPopup_false",popupGenerated:!1}),!1;if(this.popup||n.isOpen)return this.log("popup_suppressed",{reason:this.popup?"popup_active":"chat_open"}),this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:this.popup?"popup_active":"chat_open",popupGenerated:!0}),(d=this.analytics)==null||d.track("POPUP","popup_suppressed",{reason:this.popup?"popup_active":"chat_open"}),!1;if(r.popupShown||r.dismissed)return this.log("popup_suppressed",{reason:r.dismissed?"dismissed":"already_shown"}),this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:r.dismissed?"dismissed":"already_shown",popupGenerated:!0}),(p=this.analytics)==null||p.track("POPUP","popup_suppressed",{reason:r.dismissed?"dismissed":"already_shown"}),!1;if(r.engageCount>=Fe)return this.log("popup_suppressed",{reason:"frequency_budget"}),this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:"frequency_budget",popupGenerated:!0}),(c=this.analytics)==null||c.track("POPUP","popup_suppressed",{reason:"frequency_budget"}),!1;if(r.lastEngageAt&&Date.now()-r.lastEngageAt<Q)return this.log("popup_suppressed",{reason:"cooldown"}),this.log("[popup-trace] stage=10_widget_rendering",{passed:!1,reason:"cooldown",cooldownRemainingMs:Math.max(0,Q-(Date.now()-r.lastEngageAt)),popupGenerated:!0}),(h=this.analytics)==null||h.track("POPUP","popup_suppressed",{reason:"cooldown"}),!1;let l=this.identity;return this.popup=Re(t.layer,e,{onCta:w=>{var _,g,le,pe,de,ce,ue,he,fe,ge,me,ve,ye;let y=(le=(g=w==null?void 0:w.actionId)!=null?g:(_=e.action)==null?void 0:_.actionId)!=null?le:e.primaryAction;this.log("popup_clicked",{popupType:(pe=e.popupType)!=null?pe:null,tone:(de=e.tone)!=null?de:null,actionId:y!=null?y:null}),e.delivery&&l?this.delivery.notify("clicked",e.delivery,l):(ce=this.analytics)==null||ce.track("POPUP","popup_clicked",{popupType:e.popupType,label:e.tone,actionId:y,flush:!0}),y&&((ue=this.analytics)==null||ue.track("POPUP",`${y}_clicked`,{popupType:e.popupType,actionId:y,flush:!0})),this.popup=null,!(w&&this.executeBusinessAction(w,(ge=(fe=(he=e.title)!=null?he:w.label)!=null?fe:e.body)!=null?ge:e.message))&&(e.ctaUrl&&this.navigate(e.ctaUrl)||e.cta&&this.openChat((ye=(ve=(me=e.title)!=null?me:e.cta)!=null?ve:e.body)!=null?ye:e.message))},onDismiss:()=>{var w,y,_;this.log("popup_dismissed",{popupType:(w=e.popupType)!=null?w:null,tone:(y=e.tone)!=null?y:null}),e.delivery&&l?this.delivery.notify("dismissed",e.delivery,l):(_=this.analytics)==null||_.track("POPUP","popup_dismissed",{popupType:e.popupType,label:e.tone,flush:!0}),this.popup=null,i.markDismissed(),this.showLauncher()}}),i.markEngaged(),i.markPopupShown(),this.log("popup_displayed",{popupType:(f=e.popupType)!=null?f:null,tone:(b=e.tone)!=null?b:null}),e.delivery||(S=this.analytics)==null||S.track("POPUP","popup_displayed",{popupType:e.popupType,label:e.tone,actionId:(v=e.primaryAction)!=null?v:(m=e.action)==null?void 0:m.actionId,flush:!0}),this.log("[popup-trace] stage=10_widget_rendering",{passed:!0,popupGenerated:!0,popupType:e.popupType,title:e.title}),e.delivery&&l&&this.delivery.notify("displayed",e.delivery,l),this.launcher&&t.layer.appendChild(this.launcher),!0}eventsClientState(){var t,i,n,r;let e=(i=(t=this.session)==null?void 0:t.get())!=null?i:{popupShown:!1,lastEngageAt:null,engageCount:0,dismissed:!1};return{popupShown:e.popupShown,lastPopupAt:e.lastEngageAt,dismissed:e.dismissed,chatOpen:(r=(n=this.chat)==null?void 0:n.isOpen)!=null?r:!1,popupActive:this.popup!==null,popupCount:e.engageCount,safety:this.safety.snapshot()}}executeBusinessAction(e,t){if(!e||!e.enabled)return!1;if(e.destinationType==="CHAT")return this.openChat(t!=null?t:e.label),!0;let i=Ot(e.destinationType,e.destination);return i?this.navigate(i,e.destinationType):(this.log("missing business action destination",e.actionId),!1)}dismissPopup(){var e,t,i,n;(e=this.popup)==null||e.remove(!0),this.popup=null,(n=(t=this.root)==null?void 0:(i=t.layer).querySelectorAll)==null||n.call(i,".aire-popup").forEach(r=>r.remove())}openChat(e){var t;this.dismissPopup(),this.safety.setChatOpen(!0),this.hideLauncher(),(t=this.chat)==null||t.open(e)}popupPageContext(){return{pageInstanceId:this.pageInstanceId,pageStartedAt:this.pageStartedAt,...this.safety.snapshot()}}onSafetyChange(){var i,n,r;let e=this.legacyRequest!==null;(i=this.legacyRequest)==null||i.abort();let t=(n=this.sensors)==null?void 0:n.cancelPending();this.safety.snapshot().blockedReason&&this.dismissPopup(),(t||e||this.acceptingPopup)&&this.contextTimer===null&&(this.contextTimer=window.setTimeout(()=>{this.contextTimer=null,this.identity&&this.delivery.context(this.identity,this.popupPageContext())},150)),(r=this.sensors)==null||r.requestOpportunity()}navigate(e,t="URL"){let n=e.startsWith("/")&&!e.startsWith("//");if(!n)try{let r=new URL(e,window.location.origin).protocol;n=r==="http:"||r==="https:"||r==="tel:"||r==="mailto:"}catch(r){n=!1}return n?(this.log("executing action destination",{destinationType:t,url:e}),window.location.assign(e),!0):(this.log("blocked unsafe action destination",e),!1)}showLauncher(){let e=this.root,t=this.chat;if(!e||!t||this.launcher||t.isOpen)return;let i=u("button","aire-launcher");i.setAttribute("aria-label","Open chat"),i.innerHTML=Rt,i.addEventListener("click",()=>this.openChat()),e.layer.appendChild(i),this.launcher=i}hideLauncher(){var e;(e=this.launcher)==null||e.remove(),this.launcher=null}log(...e){this.cfg.debug&&console.log("[AIRE]",...e)}};function Ot(s,e){let t=e.trim();return t?s==="PHONE"?t.startsWith("tel:")?t:`tel:${t}`:s==="EMAIL"?t.startsWith("mailto:")?t:`mailto:${t}`:t:null}function ze(){if(window.__aireLoaded)return;window.__aireLoaded=!0;let s=be();s.debug&&(console.log("[AIRE] booting widget..."),console.log("[AIRE] config:",JSON.stringify(s)));try{let e=new ee(s);e.start(),window.Aire=e,s.debug&&console.log("[AIRE] widget started successfully")}catch(e){s.debug&&console.warn("[AIRE] failed to start; widget disabled")}}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",ze,{once:!0}):ze();})();
