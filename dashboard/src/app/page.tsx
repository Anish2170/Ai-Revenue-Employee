'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import styles from './landing.module.css';

const navItems = [
  { href: '#product', label: 'Product', hasChevron: true },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#operator-experience', label: 'Use Cases' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#resources', label: 'Resources', hasChevron: true },
];

function BrandMark() {
  return <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>;
}

function HeaderBrandMark() {
  return <span className={styles.headerBrandMark} aria-hidden="true"><i /><b /></span>;
}

function Arrow() {
  return <span className={styles.arrow} aria-hidden="true">-&gt;</span>;
}

function HeaderArrow() {
  return (
    <svg className={styles.headerArrow} aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function useRevealGroup<T extends HTMLElement>() {
  const rootRef = useRef<T>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const revealAll = () => items.forEach((item) => item.classList.add(styles.revealVisible));

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      revealAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).classList.add(styles.revealVisible);
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.14, rootMargin: '0px 0px -7% 0px' },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return rootRef;
}

function LandingHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const firstMenuLinkRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstMenuLinkRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }

      if (event.key === 'Tab') {
        const menuLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('#mobile-navigation a'));
        const focusableItems = [menuButtonRef.current, ...menuLinks].filter(
          (item): item is HTMLButtonElement | HTMLAnchorElement => Boolean(item),
        );
        const firstItem = focusableItems[0];
        const lastItem = focusableItems.at(-1);

        if (event.shiftKey && document.activeElement === firstItem) {
          event.preventDefault();
          lastItem?.focus();
        } else if (!event.shiftKey && document.activeElement === lastItem) {
          event.preventDefault();
          firstItem?.focus();
        }
      }
    };

    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isMenuOpen]);

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className={styles.header}>
      <nav className={styles.nav} aria-label="Main navigation">
        <Link href="/" className={styles.headerLogo} aria-label="AI Revenue Employee home">
          <HeaderBrandMark />
          <span>AI Revenue Employee</span>
        </Link>

        <div className={styles.navLinks}>
          {navItems.map((item) => (
            <Link key={item.label} href={item.href}>
              {item.label}
              {item.hasChevron && <span className={styles.chevron} aria-hidden="true" />}
            </Link>
          ))}
        </div>

        <div className={styles.navActions}>
          <Link href="/login" className={styles.loginLink}>Log in</Link>
          <Link href="/signup" className={styles.navCta}>Get started <HeaderArrow /></Link>
        </div>

        <button
          ref={menuButtonRef}
          className={styles.menuButton}
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls="mobile-navigation"
          aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setIsMenuOpen((open) => !open)}
        >
          <span /><span /><span />
        </button>
      </nav>

      {isMenuOpen && (
        <>
          <button className={styles.menuBackdrop} type="button" tabIndex={-1} aria-label="Close navigation menu" onClick={closeMenu} />
          <nav className={styles.mobileMenu} id="mobile-navigation" aria-label="Mobile navigation">
            <div className={styles.mobileLinks}>
              {navItems.map((item, index) => (
                <Link
                  key={item.label}
                  ref={index === 0 ? firstMenuLinkRef : undefined}
                  href={item.href}
                  onClick={closeMenu}
                >
                  {item.label}
                  {item.hasChevron && <span className={styles.chevron} aria-hidden="true" />}
                </Link>
              ))}
            </div>
            <div className={styles.mobileActions}>
              <Link href="/login" onClick={closeMenu}>Log in</Link>
              <Link href="/signup" className={styles.mobileCta} onClick={closeMenu}>Get started <HeaderArrow /></Link>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}

function RevenueIntelligenceStage() {
  return (
    <div className={styles.stitchStage} role="img" aria-label="AI revenue intelligence flow observing buyer behavior and understanding commercial intent">
      <div className={styles.stitchBrowser} aria-hidden="true">
        <div className={styles.stitchBrowserBar}><span /><span /><span /><i /></div>
        <div className={styles.stitchBrowserBody}>
          <div className={styles.stitchBrowserTabs}><i /><i /></div>
          <div className={styles.stitchBrowserGrid}>
            <div className={styles.stitchChart}><i /><i /><i /><i /><i /></div>
            <div className={styles.stitchStats}><i /><i /></div>
          </div>
        </div>
      </div>

      <svg className={styles.stitchConnector} viewBox="0 0 800 640" aria-hidden="true">
        <path className={styles.connectorOne} d="M280 195v30c0 16 12 28 28 28h87c16 0 28 12 28 28v31" />
        <path className={styles.connectorTwo} d="M410 340v30c0 16 12 28 28 28h88c16 0 28 12 28 28v32" />
      </svg>

      <article className={`${styles.intelligenceCard} ${styles.observeCard}`}>
        <div className={styles.intelligenceCardHead}>
          <span className={styles.intelligenceIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M3 12s3.3-5 9-5 9 5 9 5-3.3 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2.5" /></svg>
          </span>
          <span>01 OBSERVE</span>
        </div>
        <p>AI monitoring high-intent signals</p>
        <ul><li>Pricing page viewed</li><li>Case study downloaded</li><li>Feature comparison</li></ul>
        <div className={styles.intelligenceCardFoot}>Time on page: <strong>2m 18s</strong></div>
      </article>

      <article className={`${styles.intelligenceCard} ${styles.understandCard}`}>
        <div className={styles.intelligenceCardHead}>
          <span className={styles.intelligenceIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M8.5 18.5v-2.2A6 6 0 1 1 16 15.8V19" /><path d="M9 21h6M12 5v2M6.8 7.2l1.4 1.4M17.2 7.2l-1.4 1.4" /></svg>
          </span>
          <span>02 UNDERSTAND</span>
        </div>
        <p>AI interprets intent and context</p>
        <ul><li>Evaluating solution fit</li><li>High commercial intent</li><li>Budget likely available</li></ul>
        <div className={`${styles.intelligenceCardFoot} ${styles.intentScore}`}><span>Intent score</span><strong>87/100</strong></div>
      </article>

      <article className={`${styles.intelligenceCard} ${styles.engageCard}`}>
        <div className={styles.intelligenceCardHead}>
          <span className={styles.intelligenceIcon} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M5 6.5h14v10H9l-4 3v-13Z" /><path d="M9 11h6M9 14h3" /></svg>
          </span>
          <span>03 ENGAGE</span>
        </div>
        <p>AI starts a contextual conversation</p>
        <div className={styles.aiMessage}><i aria-hidden="true">✦</i><span>Hi there! I noticed you were looking at our pricing. Can I help you find the right plan for your team?</span></div>
        <div className={styles.visitorMessage}><span>We&apos;re evaluating this for a 250+ person revenue operations team.</span><i aria-hidden="true">●</i></div>
      </article>

      <article className={`${styles.intelligenceCard} ${styles.qualifyCard}`}>
        <div className={styles.intelligenceCardHead}>
          <span className={styles.intelligenceIcon} aria-hidden="true">◉</span>
          <span>04 QUALIFY</span>
        </div>
        <p>AI qualifies and captures key details</p>
        <ul className={styles.qualifyList}>
          <li>Company size: 250+</li><li>Use case: Revenue Operations</li><li>Timeline: This quarter</li><li>Budget: Confirmed</li>
        </ul>
        <div className={`${styles.intelligenceCardFoot} ${styles.confidenceScore}`}><span>Confidence</span><strong>96%</strong></div>
      </article>

      <article className={`${styles.intelligenceCard} ${styles.outcomeCard}`}>
        <div className={styles.outcomeIcon} aria-hidden="true">↗</div>
        <div>
          <strong>OPPORTUNITY QUALIFIED</strong>
          <p>Lead saved to CRM</p>
          <small>Ready for sales team.</small>
          <div className={styles.outcomeDetails}><span>Account<b>ACME Corporation</b></span><span>Opportunity size<b>$250K – $500K</b></span></div>
          <span className={styles.outcomeButton}>View in CRM <HeaderArrow /></span>
        </div>
      </article>
    </div>
  );
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

// Retained as a future product-detail visual; the landing page now uses EmployeeCapabilities.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
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

const employeeCapabilities = [
  { title: 'Understands your business', description: 'Learns your website, products, services, pricing and FAQs.', steps: [['*', 'Observed', 'Website, pricing and FAQ pages.'], ['o', 'Organized', 'Products, plans and answers mapped.'], ['+', 'Learned', 'Business knowledge becomes available.'], ['v', 'Ready', 'Answers stay on-brand and grounded.']] },
  { title: 'Detects buying intent', description: 'Identifies high-intent visitors before opportunities slip away.', steps: [['*', 'Observed', 'Returned to pricing twice this week.'], ['o', 'Interpreted', 'Comparing plans and evaluating fit.'], ['+', 'Scored', 'Commercial intent passed threshold.'], ['v', 'Ready', 'Right moment identified to engage.']] },
  { title: 'Starts conversations automatically', description: 'Engages visitors at the right moment.', steps: [['*', 'Observed', 'Visitor viewed implementation details.'], ['o', 'Interpreted', 'Likely needs help evaluating rollout.'], ['+', 'Acted', 'Opened a relevant, timely chat.'], ['v', 'Engaged', 'Visitor received contextual support.']] },
  { title: 'Answers with your knowledge', description: 'Gives answers grounded in your business.', steps: [['*', 'Observed', 'Visitor asked about deployment timing.'], ['o', 'Retrieved', 'Approved implementation documentation.'], ['+', 'Answered', 'Shared a clear, accurate response.'], ['v', 'Informed', 'Visitor gets the details they need.']] },
  { title: 'Qualifies and captures leads', description: 'Turns conversations into opportunities.', steps: [['*', 'Observed', 'Buyer shared team size and timeline.'], ['o', 'Qualified', 'Enterprise fit and active project identified.'], ['+', 'Captured', 'Contact and buying context saved.'], ['v', 'Handoff', 'Sales receives a qualified opportunity.']] },
  { title: 'Shows you why it acted', description: 'Reveals what the AI noticed, why it acted, and what happened next.', steps: [['*', 'Observed', 'Pricing page viewed three times in five minutes.'], ['o', 'Interpreted', 'High buying intent for Enterprise plan.'], ['+', 'Acted', 'Started a tailored proactive chat.'], ['v', 'Outcome', 'Lead captured and demo booked.']] },
] as const;

function CapabilityIcon({ index }: { index: number }) {
  const paths = [
    <><path d="M12 3.5a4 4 0 0 1 6.4 3.2 3.5 3.5 0 0 1 1.2 6.7 3.5 3.5 0 0 1-4.1 5.1 4 4 0 0 1-7 0 3.5 3.5 0 0 1-4.1-5.1 3.5 3.5 0 0 1 1.2-6.7A4 4 0 0 1 12 3.5Z" /><path d="M9 9.2c1.7-1.2 4.3-1.2 6 0M9 14.8c1.7 1.2 4.3 1.2 6 0M12 6v12" /></>,
    <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
    <><path d="M5 17.5 4 21l4.2-2.2c1.1.5 2.4.7 3.8.7 4.4 0 8-2.9 8-6.5s-3.6-6.5-8-6.5-8 2.9-8 6.5c0 1.6.7 3.1 1.9 4.1Z" /><path d="M15.5 16.7 19 19l-.2-3.3" /></>,
    <><path d="M4 5.5c2.6-.9 5.3-.7 8 1.1 2.7-1.8 5.4-2 8-1.1v13c-2.6-.9-5.3-.7-8 1.1-2.7-1.8-5.4-2-8-1.1v-13Z" /><path d="M12 6.6v13M7 9.5h2.5M14.5 9.5H17M7 13h2.5M14.5 13H17" /></>,
    <><circle cx="10" cy="8" r="3.8" /><path d="M3.5 20c.7-4 3-6 6.5-6s5.8 2 6.5 6M17 16.5l2 2 3.5-4" /></>,
    <><path d="M5 5h10.5A3.5 3.5 0 0 1 19 8.5V19H8.5A3.5 3.5 0 0 1 5 15.5V5Z" /><path d="m11 13 2.2-2.2 1.8 1.8L20 7.5M16 7.5h4v4" /></>,
  ];
  return <svg className={styles.capabilityIcon} viewBox="0 0 24 24" aria-hidden="true">{paths[index]}</svg>;
}

function EmployeeCapabilities() {
  const revealRef = useRevealGroup<HTMLElement>();

  return <section ref={revealRef} className={styles.capabilitiesSection} id="operator-experience">
    <div className={styles.capabilitiesInner}>
      <div className={styles.capabilitiesCopy} data-reveal="up">
        <p className={styles.capabilitiesEyebrow}>03 / What your AI employee can do</p>
        <h2>What your<br />AI Employee<br /><span>can do.</span></h2>
        <p>From first visit to qualified pipeline, your AI Employee works 24/7 to drive revenue.</p>
        <div className={styles.capabilityDots} aria-hidden="true" />
      </div>
      <div className={styles.capabilityList}>
        {employeeCapabilities.map(({ title, description }, index) => {
          return <article key={title} className={styles.capabilityCard} data-reveal="soft" data-reveal-delay={String(index % 3)}>
            <div className={styles.capabilityTrigger}>
              <span className={styles.capabilityNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.capabilityText}><strong>{title}</strong><small>{description}</small></span>
              <CapabilityIcon index={index} />
              <span className={styles.capabilityStaticMark} aria-hidden="true" />
            </div>
          </article>;
        })}
      </div>
    </div>
  </section>;
}

function DifferenceProductCard() {
  return (
    <div className={styles.differenceProductCard}>
      <div className={styles.differenceProductTop}>
        <div className={styles.differenceChair} aria-label="Green ergonomic office chair" role="img" />
        <div><strong>Ergonomic<br />Office Chair</strong><span>$649</span><button type="button">View details</button></div>
      </div>
      <div className={styles.differenceProductFoot}><span aria-hidden="true">&#9673;</span><p>Visitor spends 2+ minutes<br />viewing product details</p></div>
    </div>
  );
}

function DifferenceSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isAnimated, setIsAnimated] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || isAnimated) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsAnimated(true);
          observer.disconnect();
        }
      },
      { threshold: 0.18 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [isAnimated]);

  return (
    <section ref={sectionRef} className={`${styles.contrastSection} ${styles.differenceMotion} ${isAnimated ? styles.differenceAnimated : ''}`} id="product">
      <p className={styles.sectionNumber}>01 / The difference</p>
      <div className={styles.differenceHeading}>
        <h2>Same visitor.<br />Two very <em>different</em> outcomes.</h2>
        <p>Most conversations end in dead ends. AI Revenue Employee™ turns<br className={styles.desktopBreak} /> every high-intent moment into a qualified opportunity.</p>
      </div>

      <div className={styles.differenceBoard}>
        <article className={`${styles.differenceJourney} ${styles.traditionalJourney}`}>
          <div className={styles.journeyIntro}>
            <strong>Traditional chatbot</strong>
            <p>Rule-bound. Reactive.<br />Conversations stall—<br />revenue walks away.</p>
            <div className={styles.journeyBadge} aria-hidden="true"><span>•••</span></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>1</b><span>Visitor shows intent</span></div>
            <DifferenceProductCard />
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>2</b><span>Chatbot waits</span></div>
            <div className={`${styles.differenceCard} ${styles.chatbotCard}`}>
              <div className={styles.miniCardHead}><span>▦</span><strong>Chatbot</strong><i>⋮</i></div>
              <p>Hi there! How can I<br />help you today?</p>
              <small>Type your message... <b>↗</b></small>
            </div>
            <div className={styles.stepNote}><span>◷</span><p>Generic greeting.<br />No context. No urgency.</p></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>3</b><span>Visitor leaves</span></div>
            <div className={`${styles.differenceCard} ${styles.exitCard}`}>
              <div className={styles.browserDots}>●●●</div><span className={styles.exitIcon}>⇥</span><p>Visitor exits<br />without engaging</p>
            </div>
            <div className={styles.stepNote}><span>♙</span><p>Intent fades.<br />Context is lost.</p></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>4</b><span>Opportunity lost</span></div>
            <div className={`${styles.differenceCard} ${styles.lostCard}`}><span>↘</span><p>Opportunity<br />lost</p></div>
            <div className={styles.stepNote}><span>ⓢ</span><p>No follow-up.<br />No pipeline.</p></div>
          </div>
        </article>

        <article className={`${styles.differenceJourney} ${styles.aiJourney}`}>
          <div className={styles.journeyIntro}>
            <strong>AI Revenue Employee™</strong>
            <p>Proactive. Contextual.<br />Conversations that<br />convert.</p>
            <div className={`${styles.journeyBadge} ${styles.aiBadge}`} aria-hidden="true"><span>✦</span><i>✦</i><b>✦</b></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>1</b><span>Visitor shows intent</span></div>
            <DifferenceProductCard />
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>2</b><span>AI detects buying intent</span></div>
            <div className={`${styles.differenceCard} ${styles.intentCard}`}>
              <div className={styles.miniCardHead}><span>✦</span><strong>AI Revenue Employee</strong></div>
              <div><span>✾</span><p><strong>High buying intent<br />detected</strong><small>Product view • Time on page<br />• Returning visitor</small></p></div>
            </div>
            <div className={`${styles.stepNote} ${styles.positiveNote}`}><span>✓</span><p>Intent scored in real time.<br />Prioritized instantly.</p></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>3</b><span>AI starts a contextual<br />conversation</span></div>
            <div className={`${styles.differenceCard} ${styles.conversationCard}`}>
              <p>I see you’re interested in<br />ergonomic chairs.<br />What’s most important<br />in your search?</p>
              <p>Comfort for long hours<br />and adjustable support.</p>
            </div>
            <div className={`${styles.stepNote} ${styles.positiveNote}`}><span>✓</span><p>Relevant. Timely.<br />Two-way dialogue.</p></div>
          </div>

          <div className={styles.journeyStep}>
            <div className={styles.stepLabel}><b>4</b><span>Qualified opportunity<br />captured</span></div>
            <div className={`${styles.differenceCard} ${styles.successCard}`}>
              <span className={styles.trophy} aria-hidden="true">✓</span>
              <p>Qualified opportunity<br />captured</p>
              <small>Visitor profile enriched</small>
              <small>Routed to the right person</small>
            </div>
            <div className={`${styles.stepNote} ${styles.positiveNote}`}><span>✓</span><p>Captured, enriched,<br />and ready for follow-up.</p></div>
          </div>
        </article>
      </div>

      <div className={styles.differenceFooter}><span>▥</span><p>AI Revenue Employee™ doesn’t just answer.<br /><strong>It advances the conversation—and your revenue.</strong></p></div>
    </section>
  );
}

function HowItWorksSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || isVisible) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [isVisible]);

  return (
    <section
      ref={sectionRef}
      className={`${styles.howSection} ${isVisible ? styles.howVisible : ''}`}
      id="how-it-works"
    >
      <div className={styles.howCopy}>
        <p className={styles.howEyebrow}>02&nbsp; / &nbsp;How it works</p>
        <h2>From visitor<br />signals to<br /><em>revenue</em><br />action.</h2>
        <i className={styles.howRule} aria-hidden="true" />
        <div className={styles.howBody}>
          <p>AI Revenue Employee continuously learns your business, watches for buying signals, and starts the right conversation at the right moment.</p>
          <p>The result: more qualified conversations and more revenue for your team.</p>
        </div>
        <ul className={styles.howBenefits}>
          <li><span aria-hidden="true">&#10022;</span><p><strong>Always on.</strong> 24/7 coverage across every page.</p></li>
          <li><span aria-hidden="true">&#9672;</span><p><strong>Contextual.</strong> Understands your business and buyers.</p></li>
          <li><span aria-hidden="true">&#8857;</span><p><strong>Actionable.</strong> Engages only when it matters most.</p></li>
        </ul>
      </div>

      <div className={styles.howFlow} role="img" aria-label="Four-step workflow: connect your website, build business knowledge, watch for buying intent, and start the right conversation">
        <svg className={styles.howConnectors} viewBox="0 0 900 790" aria-hidden="true">
          <defs>
            <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8Z" /></marker>
          </defs>
          <path d="M515 145 C645 150 715 178 765 244" />
          <path d="M755 490 C760 555 718 604 650 628" />
          <path d="M350 708 C235 705 170 650 145 565" />
          <path d="M138 330 C145 230 205 165 282 139" />
        </svg>

        <article className={`${styles.flowCard} ${styles.flowStepOne}`}>
          <div className={styles.flowCardHead}><span>01</span><div><h3>Connect your website</h3><p>Installs in minutes&mdash;no code required.</p></div></div>
          <div className={styles.websiteMock}>
            <div className={styles.mockBrowserBar}><i /><i /><i /><b /></div>
            <div className={styles.mockBrowserBody}><i /><i /><i /></div>
            <div className={styles.connectBadge}><strong>AI Revenue Employee</strong><span><b>&#10003;</b> Connected</span><small>24 pages discovered</small></div>
          </div>
        </article>

        <article className={`${styles.flowCard} ${styles.flowStepTwo}`}>
          <div className={styles.flowCardHead}><span>02</span><div><h3>AI learns your business</h3><p>We organize your content into a knowledge base.</p></div></div>
          <div className={styles.knowledgeMock}>
            <div><small>Your business pages</small><span>&#9633;&nbsp; Pricing</span><span>&#9633;&nbsp; Solutions</span><span>&#9633;&nbsp; Use cases</span><span>&#9633;&nbsp; Resources</span></div>
            <i aria-hidden="true" />
            <div className={styles.knowledgeBook}><small>Knowledge base</small><b aria-hidden="true">&#9783;</b><span>Your content,<br />organized by AI.</span></div>
          </div>
        </article>

        <article className={`${styles.flowCard} ${styles.flowStepThree}`}>
          <div className={styles.flowCardHead}><span>03</span><div><h3>AI watches for buying intent</h3><p>We detect high-intent signals across behavior and context.</p></div></div>
          <div className={styles.intentMock}>
            <ul>
              <li><span>&#9635;&nbsp; Visited pricing</span><time>10:12 AM</time></li>
              <li><span>&#9716;&nbsp; Returned to pricing</span><time>10:14 AM</time></li>
              <li><span>&#8984;&nbsp; Compared plans</span><time>10:16 AM</time></li>
              <li><span>&#8599;&nbsp; Viewed Enterprise</span><time>10:18 AM</time></li>
            </ul>
            <div><span>&#10022;&nbsp; High buying intent</span><b>87/100</b></div>
            <p><strong>Decision:</strong> This visitor needs help now.</p>
          </div>
        </article>

        <article className={`${styles.flowCard} ${styles.flowStepFour}`}>
          <div className={styles.flowCardHead}><span>04</span><div><h3>AI starts the right conversation</h3><p>We engage with the right message, at the right time.</p></div></div>
          <div className={styles.chatMock}>
            <div><b>&#10022;</b><strong>AI Revenue Employee</strong><i /></div>
            <p>Looks like you&apos;re comparing our plans. Want me to help you find the right one?</p>
            <p>We&apos;re evaluating this for a 250-person revenue team.</p>
            <small>Type your message... <b>&#8599;</b></small>
          </div>
        </article>

        <div className={styles.flowCore} aria-hidden="true"><span>&#8599;</span><strong>AI Revenue<br />Employee&trade;</strong></div>

        <div className={styles.flowOutcome}>
          <span aria-hidden="true">&#9813;</span>
          <p>Conversation &rarr;<br />Qualified lead &rarr;<br /><strong>Business outcome</strong></p>
          <b>Send to CRM&nbsp; &rarr;</b>
        </div>
      </div>
    </section>
  );
}

const pricingPlans = [
  {
    name: 'Starter',
    description: 'For small businesses testing AI revenue automation.',
    price: 'Free to start',
    features: ['1 website', 'AI conversations', 'Basic knowledge', 'Basic visitor intelligence', 'Lead capture', 'Basic analytics'],
    cta: 'Start free',
    href: '/signup',
  },
  {
    name: 'Growth',
    description: 'For businesses actively converting website traffic.',
    price: 'Free to start',
    features: ['Multiple websites', 'Advanced visitor intent', 'Proactive AI conversations', 'Advanced knowledge', 'Lead qualification', 'Decision intelligence', 'Advanced analytics', 'Higher usage limits'],
    cta: 'Get started',
    href: '/signup',
    recommended: true,
  },
  {
    name: 'Scale',
    description: 'For teams with larger traffic and more complex requirements.',
    price: 'Custom',
    features: ['Everything in Growth', 'Usage sized to your traffic', 'Multiple team members', 'Advanced controls', 'Priority support', 'Custom requirements'],
    cta: 'Talk to sales',
    href: 'mailto:sales@airevenueemployee.com',
  },
];

const comparisonRows = [
  ['Websites', '1', 'Multiple', 'Custom'],
  ['AI conversations', 'Included', 'Higher limits', 'Custom volume'],
  ['Knowledge', 'Basic', 'Advanced', 'Advanced'],
  ['Visitor intent', 'Basic', 'Advanced', 'Advanced'],
  ['Proactive conversations', 'Included', 'Advanced', 'Advanced'],
  ['Lead capture', 'Included', 'Included', 'Included'],
  ['Decision intelligence', 'Basic', 'Advanced', 'Advanced'],
  ['Analytics', 'Basic', 'Advanced', 'Advanced'],
  ['Team members', '1', 'Multiple', 'Custom'],
  ['Support', 'Standard', 'Standard', 'Priority'],
];

const pricingFaqs = [
  ['Is there a free trial?', 'Yes. You can start free and validate the setup before choosing a paid plan. Trial length and included usage will be shown when billing launches.'],
  ['Do I need a credit card?', 'No credit card is required to start free. We will show the full price, billing cadence, and included usage before you enter payment details.'],
  ['How is usage calculated?', 'Free access does not create a metered bill. Before paid billing begins, the selected usage unit, its exact definition, included allowance, exclusions, and current usage will be shown clearly in the product and at checkout.'],
  ['What happens when I reach my limit?', 'We will notify you before you reach it. You can upgrade or add capacity; we will not silently create surprise overage charges. Exact limit behavior will be visible before checkout.'],
  ['Can I change plans?', 'Yes. You can move between plans as your traffic, websites, and team change.'],
  ['Can I cancel anytime?', 'Yes. You can cancel before the next renewal. Your current billing-period access continues until that period ends.'],
  ['Can I use multiple websites?', 'Growth supports multiple websites, while Scale can be sized for a larger or more complex portfolio. Starter includes one website.'],
  ['Is setup really no-code?', 'Yes. Connect your website with a small install snippet and configure the AI Employee from the dashboard—no workflow building required.'],
  ['What happens to my data?', 'Your website knowledge, visitor signals, and conversations remain isolated to your workspace. Retention and deletion controls are documented before you activate paid service.'],
  ['Do you offer custom plans?', 'Yes. Scale is designed for custom traffic volumes, controls, team access, support, and implementation requirements.'],
];

function PricingSection() {
  const [billingCadence, setBillingCadence] = useState<'monthly' | 'yearly'>('monthly');
  const revealRef = useRevealGroup<HTMLElement>();

  return (
    <section ref={revealRef} className={styles.pricingSection} id="pricing" aria-labelledby="pricing-title">
      <div className={styles.pricingHero}>
        <div data-reveal="up">
          <p className={styles.pricingEyebrow}>05 <span>/</span> Pricing</p>
          <h2 id="pricing-title">Simple pricing that scales with your <em>AI Employee.</em></h2>
        </div>
        <div className={styles.pricingHeroSide} data-reveal="side" data-reveal-delay="1">
          <p>Start with the essentials, then add capacity as your website creates more conversations and opportunities.</p>
          <div className={styles.billingToggle} role="group" aria-label="Billing cadence">
            <button type="button" aria-pressed={billingCadence === 'monthly'} onClick={() => setBillingCadence('monthly')}>Monthly</button>
            <button type="button" aria-pressed={billingCadence === 'yearly'} onClick={() => setBillingCadence('yearly')}>Yearly</button>
          </div>
          <small>{billingCadence === 'monthly' ? 'Pay month to month. Cancel before your next renewal.' : 'Choose annual billing when paid plans launch. Any annual saving will be shown before checkout.'}</small>
        </div>
      </div>

      <div className={styles.planGrid}>
        {pricingPlans.map((plan, index) => (
          <article className={`${styles.planCard} ${plan.recommended ? styles.recommendedPlan : ''}`} key={plan.name} data-reveal="soft" data-reveal-delay={String(index)}>
            {plan.recommended && <span className={styles.recommendedLabel}>Recommended</span>}
            <p className={styles.planName}>{plan.name}</p>
            <h3>{plan.price}</h3>
            <small>{plan.name === 'Scale' ? 'Sized around your actual requirements' : `Paid ${billingCadence} pricing shown before checkout`}</small>
            <p className={styles.planDescription}>{plan.description}</p>
            <ul>{plan.features.map((feature) => <li key={feature}><span aria-hidden="true">✓</span>{feature}</li>)}</ul>
            <Link className={styles.planCta} href={plan.href}>{plan.cta} <Arrow /></Link>
          </article>
        ))}
      </div>

      <div className={styles.usageSection} data-reveal="up">
        <div><p className={styles.miniEyebrow}>How usage works</p><h3>What counts as usage?</h3></div>
        <div className={styles.usageBody}>
          <p>During free access, <strong>usage does not create a bill.</strong> Before paid plans launch, we will publish one primary usage meter—such as completed AI conversations—along with its exact definition and included allowance.</p>
          <div className={styles.usageSteps}>
            <span><b>01</b> Defined unit</span><i /><span><b>02</b> Included allowance</span><i /><span><b>03</b> Clear total</span>
          </div>
          <small>Before checkout, you will see exactly what is counted, what is excluded, your allowance, what happens at the limit, and the total price for your selected cadence. No silent overages.</small>
        </div>
      </div>

      <div className={styles.comparisonSection}>
        <div className={styles.subsectionHeading} data-reveal="up"><p className={styles.miniEyebrow}>Compare plans</p><h3>Choose the operating level that fits.</h3></div>
        <div className={styles.comparisonScroll} tabIndex={0} aria-label="Scrollable plan comparison" data-reveal="soft">
          <table className={styles.comparisonTable}>
            <thead><tr><th>Feature</th><th>Starter</th><th className={styles.growthColumn}>Growth <span>Recommended</span></th><th>Scale</th></tr></thead>
            <tbody>{comparisonRows.map(([feature, starter, growth, scale]) => <tr key={feature}><th>{feature}</th><td>{starter}</td><td className={styles.growthColumn}>{growth}</td><td>{scale}</td></tr>)}</tbody>
          </table>
        </div>
      </div>

      <div className={styles.valueSection} data-reveal="soft">
        <p className={styles.miniEyebrow}>The value case</p>
        <div><h3>One more qualified conversation can pay for your AI Employee.</h3><p>Instead of thinking about the cost of another tool, compare it with the value of the opportunities your website is currently missing.</p></div>
        <span aria-hidden="true">↗</span>
      </div>

      <div className={styles.pricingFaq}>
        <div className={styles.faqIntro} data-reveal="up"><p className={styles.miniEyebrow}>Pricing FAQ</p><h3>The details before you decide.</h3><p>Clear answers now, with exact commercial terms shown before billing begins.</p></div>
        <div className={styles.faqList} data-reveal="side" data-reveal-delay="1">{pricingFaqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </div>
    </section>
  );
}

export default function LandingPage() {
  const { loading, user } = useAuth();
  const router = useRouter();
  const controlRevealRef = useRevealGroup<HTMLElement>();
  const finalCtaRevealRef = useRevealGroup<HTMLElement>();

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
      <LandingHeader />

      <main id="main-content">
        <section className={styles.stitchHero}>
          <div className={styles.stitchHeroInner}>
            <div className={styles.stitchHeroCopy}>
              <p className={styles.stitchBadge}><i /> Autonomous revenue intelligence</p>
              <h1>Stop letting ready-to-buy visitors <span>disappear</span></h1>
              <p className={styles.stitchSubtitle}>Turn buying signals into qualified conversations.</p>
              <p className={styles.stitchBody}>Your AI Revenue Employee detects buying intent, engages visitors at the right moment, and qualifies opportunities before they leave.</p>
              <div className={styles.stitchActions}>
                <Link href="/signup" className={styles.stitchPrimary}>Deploy your AI Revenue Employee <HeaderArrow /></Link>
                <a href="#how-it-works" className={styles.stitchSecondary}><span aria-hidden="true">▷</span> See how it works</a>
              </div>
              <div className={styles.stitchAssurance}>
                <p className={styles.stitchAssuranceLabel}>Built to move revenue forward</p>
                <ul className={styles.stitchChecks}>
                  <li><span>01</span><div><strong>Acts at the right moment</strong><small>Engages automatically when buying intent peaks.</small></div></li>
                  <li><span>02</span><div><strong>Speaks from your knowledge</strong><small>Every answer stays grounded in approved content.</small></div></li>
                  <li><span>03</span><div><strong>Hands off real opportunities</strong><small>Sales receives qualified leads with context attached.</small></div></li>
                </ul>
                <div className={styles.stitchSecurity}>
                  <span className={styles.lockIcon} aria-hidden="true">
                    <svg viewBox="0 0 24 24"><path d="M12 3 5.5 5.7v5.8c0 4.1 2.7 7.8 6.5 9.5 3.8-1.7 6.5-5.4 6.5-9.5V5.7L12 3Z" /><path d="m9.3 12 1.8 1.8 3.8-4" /></svg>
                  </span>
                  <div><strong>Enterprise-ready by design</strong><small>Secure, controlled, and built for serious revenue teams.</small></div>
                </div>
              </div>
            </div>
            <RevenueIntelligenceStage />
          </div>
        </section>

        <section className={styles.legacyHero} aria-hidden="true">
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

        <DifferenceSection />

        <HowItWorksSection />

        <EmployeeCapabilities />

        <section ref={controlRevealRef} className={styles.controlSection} id="resources">
          <div className={styles.controlLayout}>
            <div className={styles.controlIntro} data-reveal="up">
              <p className={styles.controlEyebrow}>04 <span>/</span> See it in action</p>
              <h2>Watch your<br />AI Employee turn<br />intent into<br /><em>opportunity.</em></h2>
              <p>See how your AI Employee detects visitor intent, starts the right conversation, and turns it into a qualified opportunity.</p>
            </div>

            <div className={styles.controlVideo} role="img" aria-label="Reserved space for an AI Employee product video" data-reveal="side" data-reveal-delay="1">
              <span className={styles.videoPlaceholder}>Video placeholder</span>
              <span className={styles.videoPlay} aria-hidden="true" />
            </div>
          </div>

          <div className={styles.controlBenefits}>
            <article data-reveal="soft"><span className={styles.benefitIcon} aria-hidden="true">◎</span><div><small>01</small><h3>Detects intent</h3><p>Understands visitor behavior in real time.</p></div></article>
            <article data-reveal="soft" data-reveal-delay="1"><span className={styles.benefitIcon} aria-hidden="true">◰</span><div><small>02</small><h3>Starts the conversation</h3><p>Engages at the moment it&apos;s needed.</p></div></article>
            <article data-reveal="soft" data-reveal-delay="2"><span className={styles.benefitIcon} aria-hidden="true">♙</span><div><small>03</small><h3>Captures the opportunity</h3><p>Turns meaningful conversations into leads.</p></div></article>
          </div>

          <a className={styles.controlLink} href="#how-it-works">See how it works <Arrow /></a>
        </section>

        <PricingSection />

        <section ref={finalCtaRevealRef} className={styles.finalCta} aria-labelledby="final-cta-title">
          <div className={styles.finalCtaInner}>
            <div className={styles.finalCtaCopy} data-reveal="up">
              <p className={styles.finalCtaEyebrow}><i /> Your next opportunity may already be browsing</p>
              <h2 id="final-cta-title">Ready to put your website <em>to work?</em></h2>
              <p className={styles.finalCtaLead}>Turn the intent already happening on your website into timely, qualified conversations.</p>
              <div className={styles.finalCtaSignals} aria-label="Setup benefits">
                <span data-reveal="soft"><b>01</b>No-code setup</span>
                <span data-reveal="soft" data-reveal-delay="1"><b>02</b>You set the boundaries</span>
                <span data-reveal="soft" data-reveal-delay="2"><b>03</b>Visible decision trail</span>
              </div>
            </div>

            <aside className={styles.finalCtaPanel} data-reveal="side" data-reveal-delay="1">
              <span>Start with one website</span>
              <h3>Connect. Configure.<br />Go live.</h3>
              <p>Give your AI Employee the knowledge and controls it needs. You review the setup before it starts engaging visitors.</p>
              <Link href="/signup" className={styles.lightCta}>Connect your website <Arrow /></Link>
              <small>Setup takes minutes. No workflow builder required.</small>
            </aside>
          </div>
        </section>
      </main>

      <footer className={styles.footer}><div><Link href="/" className={styles.logo}><BrandMark /><span>AI Revenue Employee</span></Link><p>Revenue intelligence with a visible decision trail.</p></div><div><Link href="/login">Log in</Link><Link href="/signup">Get started</Link><span>© 2026 AI Revenue Employee</span></div></footer>
    </div>
  );
}
