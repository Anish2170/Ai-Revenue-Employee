'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';

type Site = { id: string; name: string; url: string };
type NavLink = { href: string; label: string; icon: Parameters<typeof Icon>[0]['name'] };
const MAIN: NavLink[] = [{ href: '/overview', label: 'Overview', icon: 'home' }, { href: '/activity', label: 'Activity', icon: 'activity' }, { href: '/leads', label: 'Leads', icon: 'person_add' }, { href: '/analytics', label: 'Analytics', icon: 'insights' }];
const CONFIGURE: NavLink[] = [{ href: '/websites', label: 'Sites', icon: 'language' }, { href: '/websites', label: 'Knowledge', icon: 'database' }, { href: '/website-actions', label: 'Actions', icon: 'ads_click' }];
const ADVANCED: NavLink[] = [{ href: '/ai-decision-log', label: 'Decision log', icon: 'psychology' }, { href: '/knowledge-debug', label: 'Knowledge diagnostics', icon: 'search_check' }];
const SITE_KEY = 'dashboard:selectedWebsiteId';

function workspaceError(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load your workspace.';
}

function active(pathname: string, href: string, label: string) { if (label === 'Knowledge') return pathname.startsWith('/websites/'); return pathname === href || pathname.startsWith(`${href}/`); }
function NavItem({ link, pathname }: { link: NavLink; pathname: string }) { const selected = active(pathname, link.href, link.label); return <Link href={link.href} className={`ops-nav-item ${selected ? 'is-active' : ''}`}><Icon name={link.icon} /><span>{link.label}</span></Link>; }
function NavGroup({ label, children }: { label: string; children: React.ReactNode }) { return <section className="ops-nav-group"><p>{label}</p>{children}</section>; }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, role, loading: authLoading, logout } = useAuth(); const pathname = usePathname(); const router = useRouter(); const [sites, setSites] = useState<Site[]>([]); const [siteId, setSiteId] = useState(''); const [loadingSites, setLoadingSites] = useState(true); const [error, setError] = useState(''); const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => { if (!authLoading && !user) router.replace('/login'); }, [authLoading, router, user]);
  useEffect(() => { let alive = true; api.listWebsites().then((data) => { if (!alive) return; const list = data as Site[]; setSites(list); setSiteId(window.localStorage.getItem(SITE_KEY) || list[0]?.id || ''); }).catch((cause) => alive && setError(workspaceError(cause))).finally(() => alive && setLoadingSites(false)); return () => { alive = false; }; }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => { if (!loadingSites && sites.length === 0 && pathname !== '/onboarding' && pathname !== '/settings' && !error) router.replace('/onboarding'); }, [error, loadingSites, pathname, router, sites.length]);
  const selectSite = (value: string) => { setSiteId(value); if (value) window.localStorage.setItem(SITE_KEY, value); };
  if (authLoading || !user || loadingSites) return <div className="ops-app-loading"><span>Loading workspace</span></div>;
  if (error) return <div className="ops-app-loading"><div className="ops-error"><div><strong>Unable to load the workspace</strong><p>{error}</p></div><button className="ops-button ops-button--secondary" onClick={() => window.location.reload()}>Try again</button></div></div>;
  const diagnosticLinks = role === 'OWNER' || role === 'ADMIN' ? ADVANCED : [];
  return <div className="ops-shell"><aside className={`ops-sidebar ${mobileOpen ? 'is-open' : ''}`}><div className="ops-brand"><Link href={sites.length ? '/overview' : '/onboarding'}><span>AR</span><strong>AI Revenue Employee</strong></Link></div><div className="ops-sidebar-context"><span>Current site</span><select value={siteId} onChange={(event) => selectSite(event.target.value)} aria-label="Current site">{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></div><nav aria-label="Product navigation"><div className="ops-nav-main">{MAIN.map((link) => <NavItem key={link.label} link={link} pathname={pathname} />)}</div><NavGroup label="Configure">{CONFIGURE.map((link) => <NavItem key={link.label} link={link} pathname={pathname} />)}</NavGroup>{diagnosticLinks.length > 0 && <NavGroup label="Advanced">{diagnosticLinks.map((link) => <NavItem key={link.label} link={link} pathname={pathname} />)}</NavGroup>}<div className="ops-nav-settings"><NavItem link={{ href: '/settings', label: 'Settings', icon: 'settings' }} pathname={pathname} /></div></nav><div className="ops-account"><div><strong>{user.name || 'Account'}</strong><span>{user.email}</span></div><button onClick={() => logout()}>Log out</button></div></aside><div className="ops-mobile-bar"><Link href="/overview" className="ops-mobile-brand">AR</Link><div>{sites.find((site) => site.id === siteId)?.name || 'AI Revenue Employee'}</div><button aria-label="Open navigation" onClick={() => setMobileOpen((open) => !open)}><Icon name="menu" /></button></div><main className="ops-workspace"><div className="ops-workspace-inner">{children}</div></main><nav className="ops-bottom-nav" aria-label="Mobile primary navigation">{MAIN.slice(0, 4).map((link) => <NavItem key={link.label} link={link} pathname={pathname} />)}</nav></div>;
}
