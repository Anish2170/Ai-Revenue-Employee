'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#workflow', label: 'How It Works' },
  { href: '#customers', label: 'Customers' },
];

function Icon({ children }: { children: string }) {
  return <span className="material-symbols-outlined" aria-hidden="true">{children}</span>;
}

export default function LandingPage() {
  const [active, setActive] = useState('features');

  useEffect(() => {
    const sections = navLinks
      .map((link) => document.getElementById(link.href.slice(1)))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: '-22% 0px -58% 0px', threshold: [0.15, 0.35, 0.6] },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  return (
    <div className="landing-page">
      <nav className="landing-nav">
        <div className="landing-nav-inner">
          <Link href="/" className="landing-logo">AI Revenue Employee</Link>
          <div className="landing-nav-links" aria-label="Landing page navigation">
            {navLinks.map((link) => (
              <a key={link.href} className={active === link.href.slice(1) ? 'active' : ''} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
          <div className="landing-actions">
            <Link className="btn btn-secondary btn-small" href="/login">Login</Link>
            <Link className="btn btn-primary btn-small" href="/signup">Get Started Free</Link>
          </div>
        </div>
      </nav>

      <main>
        <section className="landing-hero" id="pricing">
          <h1>Stop Losing High-Intent Visitors.</h1>
          <p>
            AI Revenue Employee watches visitor behavior, detects buying intent, starts conversations automatically,
            and turns more visitors into customers.
          </p>
          <div className="hero-buttons">
            <Link className="btn btn-primary" href="/signup">Start Free</Link>
            <Link className="btn btn-secondary" href="/signup">Book Demo</Link>
          </div>

          <div className="browser-mockup" aria-label="AI Revenue Employee pricing intervention preview">
            <div className="browser-chrome">
              <div className="traffic-lights" aria-hidden="true">
                <span className="red" />
                <span className="yellow" />
                <span className="green" />
              </div>
              <div className="address-wrap">
                <div className="address-bar"><Icon>lock</Icon><span>acme-corp.com/pricing</span></div>
              </div>
              <div className="chrome-spacer" />
            </div>
            <div className="browser-content">
              <div className="status-chip"><Icon>timer</Icon> Reading pricing for 18s</div>
              <h2>Choose Your Plan</h2>
              <div className="pricing-grid">
                <div className="pricing-card">
                  <div className="plan-label">Starter</div>
                  <div className="plan-price">$0<span>/mo</span></div>
                  <ul>
                    <li><Icon>check</Icon>Basic features included</li>
                    <li><Icon>check</Icon>Up to 1,000 visitors</li>
                    <li><Icon>check</Icon>Standard support</li>
                  </ul>
                </div>
                <div className="pricing-card popular">
                  <div className="popular-badge">Popular</div>
                  <div className="plan-label">Pro</div>
                  <div className="plan-price">$49<span>/mo</span></div>
                  <ul>
                    <li><Icon>check</Icon>All Starter features</li>
                    <li><Icon>check</Icon>Up to 10,000 visitors</li>
                    <li><Icon>check</Icon>Advanced intent detection</li>
                    <li><Icon>check</Icon>Priority support</li>
                  </ul>
                </div>
                <div className="pricing-card">
                  <div className="plan-label">Enterprise</div>
                  <div className="plan-price custom">Custom</div>
                  <ul>
                    <li><Icon>check</Icon>Unlimited visitors</li>
                    <li><Icon>check</Icon>Custom integrations</li>
                    <li><Icon>check</Icon>Dedicated success manager</li>
                  </ul>
                </div>
              </div>
              <div className="ai-popup">
                <div className="popup-copy">
                  <div className="popup-icon"><Icon>support_agent</Icon></div>
                  <div>
                    <h4>Need help choosing a plan?</h4>
                    <p>I can quickly explain the differences between these plans.</p>
                  </div>
                </div>
                <Link className="popup-primary" href="/signup">Compare Plans</Link>
                <Link className="popup-secondary" href="/signup">Maybe Later</Link>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" id="features">
          <h2>Intelligence Designed for Revenue</h2>
          <div className="feature-grid">
            <article className="feature-card">
              <div className="feature-icon"><Icon>chat_bubble</Icon></div>
              <h3>Popup Intelligence</h3>
              <p>Context-aware interventions that appear exactly when the user exhibits high-intent behaviors, avoiding disruptive early popups.</p>
            </article>
            <article className="feature-card">
              <div className="feature-icon"><Icon>radar</Icon></div>
              <h3>Intent Detection</h3>
              <p>Analyzes mouse movements, scroll depth, and hesitation on key elements to predict buying intent before a click happens.</p>
            </article>
            <article className="feature-card">
              <div className="feature-icon"><Icon>insights</Icon></div>
              <h3>Behavioral Insights</h3>
              <p>Aggregates anonymous user paths to optimize where and when the AI Revenue Employee should initiate contact.</p>
            </article>
          </div>
        </section>

        <section className="workflow-section" id="workflow">
          <h2>A Seamless Workflow</h2>
          <div className="workflow-grid">
            <div className="workflow-line" />
            {[['1', 'Connect', 'Install one simple script on your site.'], ['2', 'Learn', 'AI ingests your knowledge base automatically.'], ['3', 'Detect', 'Real-time intent monitoring begins instantly.'], ['4', 'Intervene', 'Smart popups engage high-value targets.']].map(([step, title, copy]) => (
              <article className="workflow-step" key={step}>
                <div>{step}</div>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="comparison-section" id="customers">
          <div className="comparison-heading">
            <h2>Proactive Revenue vs. Reactive Chat</h2>
            <p>Why waiting for users to click a chat bubble is costing you conversions.</p>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Feature</th>
                  <th>Traditional Chatbots</th>
                  <th>AI Revenue Employee</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Initiation</td>
                  <td>Waits for user to click a generic bubble</td>
                  <td>Proactively starts conversation based on behavior</td>
                </tr>
                <tr>
                  <td>Context</td>
                  <td>Asks &quot;How can I help you?&quot;</td>
                  <td>Offers specific help based on current page</td>
                </tr>
                <tr>
                  <td>Conversion Rate</td>
                  <td>Low (Reactive)</td>
                  <td>High (Targeted Intent)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="landing-footer" id="resources">
        <div className="footer-inner">
          <div className="footer-brand">
            <h3>AI Revenue Employee</h3>
            <p>© 2024 AI Revenue Employee. All rights reserved.</p>
          </div>
          <div>
            <a href="#features">Product</a>
            <a href="#features">Features</a>
            <a href="#resources">Security</a>
          </div>
          <div>
            <a href="#resources">Resources</a>
            <a href="#resources">Blog</a>
            <a href="#resources">Guides</a>
          </div>
          <div>
            <a href="#resources">Legal</a>
            <a href="#resources">Privacy Policy</a>
            <a href="#resources">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
}


