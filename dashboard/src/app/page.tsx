'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import styles from './landing.module.css';

const navItems = [
  { href: '#product', label: 'Product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '#proof', label: 'Results' },
];

function BrandMark() {
  return <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>;
}

function Arrow() {
  return <span className={styles.arrow} aria-hidden="true">-&gt;</span>;
}

function ProductStage() {
  return (
    <div className={styles.productStage} role="img" aria-label="Product demonstration: a pricing visitor is detected, engaged, and captured as a qualified lead">
      <div className={styles.stageTopbar}>
        <div className={styles.windowControls} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.stageAddress}><span aria-hidden="true">&#9679;</span> northstar.io/pricing</div>
        <div className={styles.stageStatus}><i /> AI employee observing</div>
      </div>

      <div className={styles.stageBody}>
        <div className={styles.websiteView}>
          <div className={styles.websiteNav}>
            <span className={styles.demoLogo}>N</span>
            <strong>Northstar</strong>
            <div><span>Product</span><span>Solutions</span><span>Pricing</span></div>
            <span className={styles.demoButton}>Start free</span>
          </div>
          <div className={styles.websiteContent}>
            <div className={styles.demoEyebrow}>Simple, transparent pricing</div>
            <h2>Choose a plan that grows<br />with your revenue team.</h2>
            <div className={styles.priceGrid}>
              <div><span>Starter</span><strong>$49</strong><small>For early teams</small></div>
              <div className={styles.focusedPlan}><span>Growth</span><strong>$149</strong><small>For scaling teams</small><b>Most evaluated</b></div>
              <div><span>Scale</span><strong>Custom</strong><small>For larger teams</small></div>
            </div>
          </div>
          <div className={styles.behaviorNote}>
            <span>Behavior signal</span>
            <strong>Second pricing visit in 3 days</strong>
            <small>Growth plan compared for 42 seconds</small>
          </div>
          <div className={styles.proactiveWidget}>
            <div className={styles.widgetHeader}><span><BrandMark /></span><small>AI Revenue Employee</small><i>×</i></div>
            <h3>Choosing between Growth and Scale?</h3>
            <p>I can compare the plans for your team and explain implementation.</p>
            <div className={styles.widgetReply}>We have 18 reps. How long does setup take?</div>
            <div className={styles.widgetAnswer}>Most teams are live in under a day. Want a tailored walkthrough?</div>
            <span className={styles.widgetCta}>Book a walkthrough <Arrow /></span>
          </div>
        </div>

        <aside className={styles.decisionPanel}>
          <div className={styles.decisionHead}>
            <div><span className={styles.mono}>DECISION 14:32:08</span><h3>Commercial intent detected</h3></div>
            <span className={styles.highIntent}>High intent</span>
          </div>
          <div className={styles.evidenceList}>
            <div><span>Observed</span><p>Returned to pricing</p><b>+32</b></div>
            <div><span>Observed</span><p>Compared Growth plan</p><b>+24</b></div>
            <div><span>Context</span><p>Viewed implementation guide</p><b>+18</b></div>
          </div>
          <div className={styles.reasoningBlock}>
            <span>Why the AI acted</span>
            <p>The visitor is evaluating fit and implementation, not casually browsing. A plan-specific offer is proportionate.</p>
          </div>
          <div className={styles.actionBlock}><span>Action</span><strong>Offer plan comparison</strong><small>Grounded in approved pricing knowledge</small></div>
          <div className={styles.outcomeBlock}>
            <div className={styles.outcomeIcon}>✓</div>
            <div><span>Outcome captured</span><strong>Qualified conversation</strong><small>Demo requested by Samira Khan, VP Revenue</small></div>
          </div>
        </aside>
      </div>

      <div className={styles.decisionRail}>
        <div><b>01</b><span>Observed</span><p>Returned to pricing</p></div>
        <div><b>02</b><span>Understands</span><p>Evaluating fit</p></div>
        <div><b>03</b><span>Acts</span><p>Plan-specific prompt</p></div>
        <div><b>04</b><span>Measures</span><p>Qualified lead captured</p></div>
      </div>
    </div>
  );
}

function OperatorPreview() {
  return (
    <div className={styles.operatorPreview} role="img" aria-label="Illustrative operator activity view showing the reason and outcome behind a qualified visitor session">
      <div className={styles.appSidebar}>
        <BrandMark />
        <span className={styles.activeNav} /><span /><span /><span /><span />
      </div>
      <div className={styles.activityList}>
        <div className={styles.appTitle}><div><span>Activity</span><h3>Meaningful sessions</h3></div><span className={styles.reviewBadge}>Needs review <b>3</b></span></div>
        <div className={`${styles.sessionRow} ${styles.selectedSession}`}><i>SK</i><div><strong>Samira Khan</strong><small>Pricing intervention · 12 min ago</small></div><span>Qualified</span></div>
        <div className={styles.sessionRow}><i>JD</i><div><strong>Jordan Davis</strong><small>Product comparison · 28 min ago</small></div><span>Review</span></div>
        <div className={styles.sessionRow}><i>ML</i><div><strong>Mei Lin</strong><small>Implementation question · 41 min ago</small></div><span>Engaged</span></div>
      </div>
      <div className={styles.sessionDetail}>
        <span className={styles.mono}>DECISION THREAD</span>
        <h3>Why the AI acted</h3>
        <p>Samira returned to pricing, compared Growth, and opened the implementation guide.</p>
        <ol>
          <li><i /> <div><span>Observed</span><b>High-value behavior</b></div></li>
          <li><i /> <div><span>Understood</span><b>Evaluating fit</b></div></li>
          <li><i /> <div><span>Acted</span><b>Offered comparison</b></div></li>
          <li><i /> <div><span>Outcome</span><b>Demo requested</b></div></li>
        </ol>
        <span className={styles.previewAction}>Open full session <Arrow /></span>
      </div>
    </div>
  );
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

  if (user) return <main className={styles.loading}>Preparing your workspace...</main>;

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#main-content">Skip to content</a>
      <header className={styles.header}>
        <nav className={styles.nav} aria-label="Main navigation">
          <Link href="/" className={styles.logo}><BrandMark /><span>AI Revenue Employee</span></Link>
          <div className={styles.navLinks}>{navItems.map((item) => <a key={item.href} href={item.href}>{item.label}</a>)}</div>
          <div className={styles.navActions}><Link href="/login" className={styles.loginLink}>Log in</Link><Link href="/signup" className={styles.navCta}>Get started <Arrow /></Link></div>
        </nav>
      </header>

      <main id="main-content">
        <section className={styles.hero}>
          <div className={styles.heroIntro}>
            <div>
              <p className={styles.eyebrow}><i /> Proactive revenue, with a reason</p>
              <h1>Turn buying signals into qualified conversations.</h1>
            </div>
            <div className={styles.heroSide}>
              <p>AI Revenue Employee notices meaningful visitor behavior, understands commercial intent, and starts the right conversation before the moment disappears.</p>
              <div className={styles.heroActions}><Link href="/signup" className={styles.primaryCta}>Launch your AI employee <Arrow /></Link><a href="#product" className={styles.secondaryCta}>See it work <span aria-hidden="true">↓</span></a></div>
              <small>No chatbot scripts. Every action has a visible reason.</small>
            </div>
          </div>
          <ProductStage />
          <div className={styles.heroTrust}><span>Built for considered B2B buying journeys</span><div><b>Behavior-aware</b><b>Knowledge-grounded</b><b>Decision-visible</b></div></div>
        </section>

        <section className={styles.contrastSection} id="product">
          <p className={styles.sectionNumber}>01 / The difference</p>
          <div className={styles.contrastHeadline}><h2>Chatbots wait for a question.<br /><em>This starts with a signal.</em></h2><p>Most high-intent visitors never open a chat bubble. AI Revenue Employee detects the moments that matter and makes a relevant first move, within rules your team controls.</p></div>
          <div className={styles.comparisonStrip}>
            <div><span>Reactive chat</span><strong>Visitor asks</strong><i>then</i><strong>AI responds</strong><small>The buying moment may already be gone.</small></div>
            <div className={styles.proactiveComparison}><span>AI Revenue Employee</span><strong>Behavior changes</strong><i>then</i><strong>AI acts with context</strong><small>Intent becomes a conversation and measurable outcome.</small></div>
          </div>
        </section>

        <section className={styles.howSection} id="how-it-works">
          <div className={styles.howIntro}><p className={styles.sectionNumber}>02 / How it works</p><h2>One continuous decision,<br />not four disconnected features.</h2></div>
          <ol className={styles.howSteps}>
            <li><span>01</span><div><h3>Observed</h3><p>It reads commercially meaningful behavior across the pages that influence a decision.</p></div><b>Behavior</b></li>
            <li><span>02</span><div><h3>Understands</h3><p>It distinguishes active evaluation from casual browsing using the visitor's context.</p></div><b>Intent</b></li>
            <li><span>03</span><div><h3>Acts</h3><p>It offers relevant help grounded in your knowledge, instructions, and approved actions.</p></div><b>Intervention</b></li>
            <li><span>04</span><div><h3>Measures</h3><p>It links the conversation and lead back to the exact behavior and decision that created it.</p></div><b>Outcome</b></li>
          </ol>
        </section>

        <section className={styles.operatorSection}>
          <div className={styles.operatorInner}>
            <div className={styles.operatorHeading}><p className={styles.lightEyebrow}>03 / Operator experience</p><h2>See the action.<br />See the reason.<br /><span>See the outcome.</span></h2><p>Your team gets an operating view of meaningful sessions, not a pile of chat transcripts.</p></div>
            <OperatorPreview />
            <div className={styles.operatorQuestions}><div><span>What happened?</span><p>A pricing visitor engaged and requested a walkthrough.</p></div><div><span>Why did AI act?</span><p>Three specific behaviors crossed the commercial-intent threshold.</p></div><div><span>What happens next?</span><p>The lead arrives with source, context, transcript, and next action.</p></div></div>
          </div>
        </section>

        <section className={styles.controlSection}>
          <div className={styles.controlIntro}><p className={styles.sectionNumber}>04 / Knowledge and control</p><h2>Capable enough to act.<br />Bounded enough to trust.</h2><p>The business decides what the AI knows, how it behaves, and which actions it can take. Every decision stays visible and reviewable.</p></div>
          <div className={styles.controlMap}>
            <div className={styles.controlSource}><span>01</span><h3>Your website</h3><p>Approved pages and product knowledge</p></div>
            <div className={styles.controlSource}><span>02</span><h3>Your instructions</h3><p>Tone, priorities, limits, and escalation</p></div>
            <div className={styles.controlCore}><BrandMark /><span>Controlled AI behavior</span><strong>Relevant action</strong><p>Only when evidence and permissions align</p></div>
            <div className={styles.controlOutcome}><span>Review</span><h3>Visible decisions</h3><p>What it noticed, why it acted, and what resulted</p></div>
          </div>
          <div className={styles.trustLine}><span>Controlled knowledge</span><span>Configurable behavior</span><span>Action review</span><span>Privacy-aware</span></div>
        </section>

        <section className={styles.proofSection} id="proof">
          <div className={styles.proofStory}>
            <p className={styles.sectionNumber}>05 / Illustrative outcome model</p>
            <span className={styles.demoLabel}>Replace with verified beta data before public claims</span>
            <h2>From silent pricing traffic to a qualified next step.</h2>
            <p className={styles.proofSummary}>A B2B software team adds one focused intervention for returning pricing visitors who also inspect implementation.</p>
            <div className={styles.proofSequence}><div><span>Problem</span><p>High-intent visitors leave without identifying themselves.</p></div><i /><div><span>Intervention</span><p>Offer plan guidance only when evaluation behavior is clear.</p></div><i /><div><span>Outcome</span><p>More useful conversations, each linked to its decision trail.</p></div></div>
          </div>
          <aside className={styles.proofMetrics}>
            <span>Illustrative target</span>
            <strong>Up to<br /><b>20%</b></strong>
            <h3>more qualified conversions</h3>
            <div><span>Pricing conversations</span><b>3.4×</b></div>
            <div><span>Decision visibility</span><b>100%</b></div>
            <small>Demonstration values only. Actual results depend on traffic, intent, offer, and implementation.</small>
          </aside>
        </section>

        <section className={styles.quoteSection}>
          <p className={styles.sectionNumber}>06 / Design-partner perspective</p>
          <blockquote>“The value is not another chat transcript. It is knowing what the visitor did, why the AI stepped in, and whether that intervention created a real next step.”</blockquote>
          <div className={styles.quoteAttribution}><span>RO</span><div><strong>Revenue operations lead</strong><small>Representative design-partner feedback</small></div></div>
        </section>

        <section className={styles.finalCta}>
          <div><p>Ready to activate the signals already on your website?</p><h2>Give intent<br />a next step.</h2></div>
          <div><p>Connect your website, set the boundaries, and see what your AI Revenue Employee can do.</p><Link href="/signup" className={styles.lightCta}>Launch your AI employee <Arrow /></Link></div>
        </section>
      </main>

      <footer className={styles.footer}><div><Link href="/" className={styles.logo}><BrandMark /><span>AI Revenue Employee</span></Link><p>Revenue intelligence with a visible decision trail.</p></div><div><Link href="/login">Log in</Link><Link href="/signup">Get started</Link><span>© 2026 AI Revenue Employee</span></div></footer>
    </div>
  );
}
