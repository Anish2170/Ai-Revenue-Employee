/** Content-value exception for short business facts; not a zero-word threshold. */
export function usefulBusinessText(text: string): boolean {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (/please wait|loading|preparing your|enable javascript/i.test(clean))
        return false;
    const words = clean.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length < 3)
        return false;
    const noise = /^(?:home|about|contact|privacy|next|previous|sign|in|out|menu|search|login|register|terms|copyright|all|rights|reserved|cookies|accept|reject|and|or)$/i;
    if (words.filter(word => !noise.test(word)).length < 3)
        return false;
    const fact = /[$₹€£¥]\s*\d|\b(?:reserve|reservation|refund|non-refundable|cancell?ation|cancell?ations|returns?|booking|appointments?|opening|closed|opens?|hours?|offered|provided|available|not available|per month|billed annually|notice|delivery|shipping)\b|\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b|(?:कीमत|वापस|उपलब्ध|नहीं)/iu;
    if (fact.test(clean))
        return true;
    return words.length >= 12 && /[.!?।]/u.test(clean) && /\b(?:service|services|design|project|product|products|restaurant|hotel|room|rooms|materials|treatment|menu|collection|consultation)\b/i.test(clean)
        || words.length >= 40 && /[.!?।]/u.test(clean);
}
