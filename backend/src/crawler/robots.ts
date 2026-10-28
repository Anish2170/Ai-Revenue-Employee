/** Bounded RFC-style allow/disallow subset; no crawling on ambiguous fetch failure. */
export interface RobotsPolicy {
    allows(url: string): boolean;
    sitemaps: string[];
    delayMs: number;
}
export function parseRobots(text: string, origin: string): RobotsPolicy {
    if (text.length > 512000 || /<html|<!doctype|\uFFFD|\u0000/i.test(text))
        throw new Error('robots_invalid');
    const groups: Array<{
        agents: string[];
        rules: Array<{
            allow: boolean;
            path: string;
        }>;
        delay: number;
    }> = [];
    let group: typeof groups[number] | undefined;
    const sitemaps: string[] = [];
    for (const raw of text.split(/\r?\n/u).slice(0, 10000)) {
        const line = raw.replace(/#.*$/u, '').trim(), colon = line.indexOf(':');
        if (colon < 0)
            continue;
        const key = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
        if (key === 'sitemap') {
            try {
                const url = new URL(value, origin);
                if (url.origin === origin)
                    sitemaps.push(url.href);
            }
            catch { }
            continue;
        }
        if (key === 'user-agent') {
            if (!group || group.rules.length || group.delay) {
                group = { agents: [], rules: [], delay: 0 };
                groups.push(group);
            }
            group.agents.push(value.toLowerCase());
        }
        else if (group && (key === 'allow' || key === 'disallow') && value)
            group.rules.push({ allow: key === 'allow', path: value });
        else if (group && key === 'crawl-delay') {
            const delay = Number(value) * 1000;
            group.delay = !Number.isFinite(delay) || delay < 0 ? Infinity : delay;
        }
    }
    const scores = groups.map(g => Math.max(0, ...g.agents.filter(a => a && a !== '*' && 'airevenueemployee-crawler'.includes(a)).map(a => a.length))), maxScore = Math.max(0, ...scores);
    const selected = maxScore ? groups.filter((_g, i) => scores[i] === maxScore) : groups.filter(g => g.agents.includes('*'));
    if (selected.some(g => g.delay > 5000))
        throw Error('robots_delay_unsupported');
    const rules = selected.flatMap(g => g.rules).map(rule => { const end = rule.path.endsWith('$'); const p = end ? rule.path.slice(0, -1) : rule.path; return { ...rule, weight: p.replace(/\*/g, '').length, re: new RegExp('^' + p.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (end ? '$' : '')) }; });
    return { sitemaps: [...new Set(sitemaps)].slice(0, 8), delayMs: Math.max(0, ...selected.map(g => g.delay)), allows(url) { const parsed = new URL(url); let path = parsed.pathname + parsed.search; try {
            path = decodeURI(path);
        }
        catch { } const matches = rules.filter(r => r.re.test(path) || r.re.test(parsed.pathname + parsed.search)).sort((a, b) => b.weight - a.weight || Number(b.allow) - Number(a.allow)); return matches[0]?.allow ?? true; } };
}
