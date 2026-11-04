/** Detect page-loading messages without treating business prose as a JS shell. */
export function hasLoadingPlaceholder(text: string): boolean {
    return /\b(?:please\s+wait|enable\s+javascript|preparing\s+your\s+(?:page|content|prices?|information|data))\b|\bloading\s+(?:(?:your|the)\s+)?(?:prices?|pricing|plans?|products?|content|data|page|services?|results?|catalog|availability|information|details)\b|\b(?:prices?|pricing|content|data|page|products?)\s+(?:(?:is|are|still|will)\s+)*(?:loading|loads?)\b|(?:^|[\r\n])\s*loading[\s.…!:,-]*(?:$|[\r\n])/i.test(text);
}

/** Readable facts, prose and lists, independent of the site's industry. */
export function usefulBusinessText(text: string): boolean {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (hasLoadingPlaceholder(text))
        return false;
    const words = clean.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length < 3)
        return false;
    const noise = /^(?:home|about|contact|privacy|next|previous|sign|in|out|menu|search|login|register|terms|copyright|all|rights|reserved|cookies|accept|reject|and|or)$/i;
    if (words.filter(word => !noise.test(word)).length < 3)
        return false;
    if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ().-]{6,}\d/iu.test(clean)) return true;
    const fact = /[$₹€£¥]\s*\d|\b(?:reserve|reservation|refund|non-refundable|cancell?ation|cancell?ations|returns?|booking|appointments?|opening|closed|opens?|hours?|offered|provided|available|not available|per month|billed annually|notice|delivery|shipping)\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|(?:कीमत|वापस|उपलब्ध|नहीं)/iu;
    if (fact.test(clean))
        return true;
    // DOM cleaning has already removed navigation and controls. Requiring a
    // particular business keyword drops valid short paragraphs from other fields
    // and also prevents their sections from ever becoming searchable chunks.
    if (words.length >= 12 && /[.!?।]/u.test(clean)) return true;
    // Descriptive lists often have no punctuation. Bare menu labels do not have
    // enough words per item to pass this check.
    const descriptiveItems = text.split(/\n+/u).filter(item =>
        (item.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => !noise.test(word)).length >= 4);
    return words.length >= 12 && descriptiveItems.length >= 2;
}
