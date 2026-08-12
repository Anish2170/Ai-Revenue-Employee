'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

const navigation = [
  { href: '#product-proof', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#results', label: 'Results' },
];

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function Arrow() {
  return <span aria-hidden="true" className="arrow">→</span>;
}

export default function LandingPage() {
  const { loading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      api.listWebsites()
        .then((websites) => router.replace((websites as unknown[]).length === 0 ? '/onboarding' : '/analytics'))
        .catch(() => router.replace('/onboarding'));
    }
  }, [loading, router, user]);

  if (user) return <main className="landing-loading">Preparing your workspace…</main>;

  return (
    <div className="landing-page">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="landing-nav">
        <nav className="landing-nav-inner" aria-label="Main navigation">
          <Link href="/" className="landing-logo"><Mark />AI Revenue Employee</Link>
          <div className="landing-nav-links">
            {navigation.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}
          </div>
          <div className="landing-actions">
            <Link className="text-link" href="/login">Log in</Link>
            <Link className="button button-small" href="/signup">Get started <Arrow /></Link>
          </div>
        </nav>
      </header>

      <main id="main-content">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow"><span />Proactive revenue, with a reason</p>
            <h1>Your website has signals.<br />Your AI employee acts on them.</h1>
            <p className="hero-summary">AI Revenue Employee observes visitor behavior, understands commercial intent, and starts the relevant conversation before a high-value visitor leaves.</p>
            <div className="hero-actions">
              <Link className="button" href="/signup">Launch your AI Revenue Employee <Arrow /></Link>
              <a className="text-link prominent-link" href="#product-proof">See the decision thread <span aria-hidden="true">↓</span></a>
            </div>
            <p className="hero-note">Designed for teams that want visibility into every AI decision.</p>
          </div>
          <div className="hero-signal" aria-label="Illustrative detected visitor signal">
            <div className="signal-kicker"><span className="signal-dot" /> Live visitor context</div>
            <p>Returning visitor</p>
            <strong>Pricing page · second visit</strong>
            <div className="signal-meter"><span /></div>
            <small>Commercial intent detected</small>
          </div>
        </section>

        <section className="proof-section" id="product-proof" aria-labelledby="proof-title">
          <div className="section-intro proof-intro">
            <p className="eyebrow">The decision thread</p>
            <h2 id="proof-title">A clear path from behavior to revenue.</h2>
            <p>One visitor journey, with the evidence and outcome connected at every step.</p>
          </div>
          <div className="decision-thread">
            <div className="thread-rail" aria-hidden="true"><span /></div>
            <article className="thread-observed">
              <div className="thread-label"><b>01</b> Observed</div>
              <div className="site-preview">
                <div className="site-top"><span className="tiny-logo">N</span><span>Northstar</span><span className="site-nav">Product &nbsp;&nbsp; Pricing &nbsp;&nbsp; Customers</span></div>
                <div className="site-content"><p>Plans that scale with<br /><strong>your revenue team.</strong></p><div className="site-prices"><span>Starter<br /><b>$49</b></span><span className="selected">Growth<br /><b>$149</b></span></div></div>
                <div className="cursor-note">Visited pricing twice</div>
              </div>
              <p className="thread-caption">A visitor returns to pricing and spends time comparing plans.</p>
            </article>
            <article className="thread-understood">
              <div className="thread-label"><b>02</b> Understands</div>
              <div className="inference-panel">
                <p className="mono-label">Decision summary</p>
                <h3>Commercial intent is high</h3>
                <ul><li>Second pricing visit in 3 days</li><li>Compared Growth plan details</li><li>Viewed implementation guide</li></ul>
                <div className="intent-tag">Intent: evaluating options</div>
              </div>
              <p className="thread-caption">The AI forms a bounded judgment from observable behavior.</p>
            </article>
            <article className="thread-acts">
              <div className="thread-label"><b>03</b> Acts</div>
              <div className="popup-preview">
                <span className="popup-close">×</span>
                <span className="popup-mark"><Mark /></span>
                <h3>Choosing between plans?</h3>
                <p>I can help you compare what your team needs—and answer questions about setup.</p>
                <button type="button">Compare plans <Arrow /></button>
                <a href="#how-it-works">Not now</a>
              </div>
              <p className="thread-caption">A helpful, relevant prompt appears at the moment it can matter.</p>
            </article>
            <article className="thread-measures">
              <div className="thread-label"><b>04</b> Measures</div>
              <div className="outcome-panel">
                <div className="outcome-status"><span>✓</span> Outcome captured</div>
                <h3>Qualified conversation</h3>
                <p>Samira Khan · VP Revenue<br />Northstar Labs</p>
                <div className="outcome-row"><span>Source</span><b>Pricing intervention</b></div>
                <div className="outcome-row"><span>Next action</span><b>Demo requested</b></div>
              </div>
              <p className="thread-caption">The result is linked back to the behavior and decision that created it.</p>
            </article>
          </div>
        </section>

        <section className="process-section" id="how-it-works" aria-labelledby="process-title">
          <div className="section-intro">
            <p className="eyebrow">How it works</p>
            <h2 id="process-title">Visible intelligence, not invisible automation.</h2>
          </div>
          <ol className="process-list">
            <li><span>01</span><div><h3>Observed</h3><p>It reads relevant visitor behavior across your highest-value pages.</p></div></li>
            <li><span>02</span><div><h3>Understands</h3><p>It identifies the difference between curiosity and commercial intent.</p></div></li>
            <li><span>03</span><div><h3>Acts</h3><p>It offers a proportionate action, grounded in your knowledge and instructions.</p></div></li>
            <li><span>04</span><div><h3>Measures</h3><p>It records the conversation, lead, and outcome so your team can improve.</p></div></li>
          </ol>
        </section>

        <section className="operator-section" aria-labelledby="operator-title">
          <div className="operator-copy">
            <p className="eyebrow">The operator experience</p>
            <h2 id="operator-title">Know what happened.<br />Know why it happened.</h2>
            <p>Every meaningful session gives your team the context to respond, review, and improve—not just another lead record.</p>
            <ul className="check-list"><li>Behavior and decision, side by side</li><li>Conversations linked to their source</li><li>Clear next actions for your team</li></ul>
          </div>
          <div className="operator-ui" aria-label="Illustrative operator activity view">
            <div className="operator-sidebar"><div className="operator-brand"><Mark /></div><span className="active" /><span /><span /><span /></div>
            <div className="operator-main"><div className="operator-top"><span>Activity</span><small>Aug 13, 2026</small></div><div className="operator-title-row"><div><b>Meaningful sessions</b><p>Visitors with a decision or outcome</p></div><button type="button">Needs review <em>3</em></button></div><div className="activity-row selected"><span className="avatar copper">SK</span><div><b>Samira Khan</b><p>Pricing intervention · 12 min ago</p></div><strong>Qualified</strong></div><div className="activity-row"><span className="avatar">JD</span><div><b>Jordan Davis</b><p>Product comparison · 28 min ago</p></div><strong>Review</strong></div><div className="activity-row"><span className="avatar">ML</span><div><b>Mei Lin</b><p>Knowledge question · 41 min ago</p></div><strong>Engaged</strong></div></div>
            <aside className="operator-detail"><span className="mono-label">Decision thread</span><h3>Samira Khan</h3><p>Returned to pricing and compared Growth.</p><div className="mini-thread"><span>Observed</span><i /><span>Understood</span><i /><span>Acted</span><i /><span>Qualified</span></div><a href="#results">View full session <Arrow /></a></aside>
          </div>
        </section>

        <section className="control-section" aria-labelledby="control-title">
          <div className="control-visual" aria-hidden="true"><div>Website</div><i>→</i><div>Knowledge</div><i>→</i><div>Instructions</div><i>→</i><div className="control-action">Actions</div></div>
          <div className="control-copy"><p className="eyebrow">Knowledge, control, trust</p><h2 id="control-title">You decide what your AI employee knows and can do.</h2><p>Ground every intervention in your website knowledge and business instructions. Review decisions, refine behavior, and keep the controls with your team.</p><div className="trust-points"><span>Controlled knowledge</span><span>Configurable behavior</span><span>Decision visibility</span><span>Privacy-first</span></div></div>
        </section>

        <section className="results-section" id="results" aria-labelledby="results-title">
          <div className="case-study"><div className="case-story"><p className="eyebrow">Customer result</p><p className="case-company">Northstar Labs <span>· B2B software</span></p><h2 id="results-title">Turn high-intent hesitation into useful conversations.</h2><p>Northstar used AI Revenue Employee on pricing and implementation pages, with a focused prompt for visitors who returned to evaluate plans.</p><dl><div><dt>Before</dt><dd>High-value traffic left without a path to ask questions.</dd></div><div><dt>After</dt><dd>Visitors received timely, controlled help—then surfaced to the revenue team with context.</dd></div></dl></div><div className="case-metrics"><div><strong>20%</strong><span>more qualified conversions<sup>up to</sup></span></div><div><strong>3.4×</strong><span>more conversations from pricing visitors</span></div><p>Illustrative results vary by traffic, intent, and implementation.</p></div></div>
          <div className="logo-strip" aria-label="Trusted by revenue teams"><span>Trusted by teams building the next revenue motion</span><b>northstar</b><b>almanac</b><b>HELIOS</b><b>HEARTH</b><b>acme</b></div>
        </section>

        <section className="testimonial-section" aria-labelledby="testimonial-title"><div className="section-intro"><p className="eyebrow">In their words</p><h2 id="testimonial-title">A revenue operation that can explain itself.</h2></div><div className="testimonial-grid"><figure><blockquote>“We finally see the full story behind a lead: the behavior, the decision, and the conversation—not just a name in a form.”</blockquote><figcaption><span className="avatar">AM</span><div><b>Alex Morgan</b><small>VP Growth, Northstar Labs</small></div></figcaption></figure><figure><blockquote>“The control is what made this useful. We could shape how it behaved before it ever spoke to a visitor.”</blockquote><figcaption><span className="avatar copper">RK</span><div><b>Riya Kapoor</b><small>Revenue Operations, Almanac</small></div></figcaption></figure><figure><blockquote>“It turns the moments that used to disappear into a clear queue our team can act on.”</blockquote><figcaption><span className="avatar">TS</span><div><b>Theo Saunders</b><small>Head of Demand, Helios</small></div></figcaption></figure></div></section>

        <section className="final-cta"><p className="eyebrow">Ready when you are</p><h2>Put your website’s<br />signals to work.</h2><p>Connect your website and give your revenue team a clearer way to activate intent.</p><Link className="button light-button" href="/signup">Launch your AI Revenue Employee <Arrow /></Link></section>
      </main>

      <footer className="landing-footer"><div className="footer-inner"><Link href="/" className="landing-logo"><Mark />AI Revenue Employee</Link><p>Revenue intelligence with a visible decision trail.</p><div><Link href="/login">Log in</Link><Link href="/signup">Get started</Link></div><small>© 2026 AI Revenue Employee</small></div></footer>
    </div>
  );
}
