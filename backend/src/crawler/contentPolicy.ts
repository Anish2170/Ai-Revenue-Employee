/** Detect page-loading messages without treating business prose as a JS shell. */
export function hasLoadingPlaceholder(text: string): boolean {
    return /\b(?:please\s+wait|enable\s+javascript|preparing\s+your\s+(?:page|content|prices?|information|data))\b|\bloading\s+(?:(?:your|the)\s+)?(?:prices?|pricing|plans?|products?|content|data|page|services?|results?|catalog|availability|information|details)\b|\b(?:prices?|pricing|content|data|page|products?)\s+(?:(?:is|are|still|will)\s+)*(?:loading|loads?)\b|(?:^|[\r\n])\s*loading[\s.…!:,-]*(?:$|[\r\n])/i.test(text);
}

/** Content-value exception for short business facts; not a zero-word threshold. */
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
    return words.length >= 12 && /[.!?।]/u.test(clean) && /\b(?:service|services|design|project|product|products|restaurant|hotel|room|rooms|materials|treatment|menu|collection|consultation|training|coach|coaches|coaching|gym|fitness|facility|facilities|classes|trial|session|assessment)\b/i.test(clean)
        || words.length >= 40 && /[.!?।]/u.test(clean);
}
