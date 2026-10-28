/** Compose bounded multi-part answers through the existing evidence contract.
 * Richer retrieval never gives arbitrary prose LLM authority. */
import { buildChatSafetyPlan, composeSafeChatReply } from '../language/chatSafety.js';
import type { ChatLanguageState } from '../language/chatLanguage.js';
import { chunkNeeds, type EvidenceNeed } from './retrievalPlan.js';
import type { ResolvedContext, RetrievedChunk } from './types.js';
const names: Record<EvidenceNeed, [
    string,
    string,
    string
]> = { price: ['Price', 'कीमत', 'Price'], features: ['Features', 'शामिल सुविधाएँ', 'Features'], refund: ['Refund policy', 'रिफंड नीति', 'Refund policy'], cancellation: ['Cancellation', 'रद्द करने की नीति', 'Cancellation'], hours: ['Opening hours', 'खुलने का समय', 'Opening hours'], process: ['Process', 'प्रक्रिया', 'Process'], booking: ['Booking', 'बुकिंग', 'Booking'], service: ['Service', 'सेवा', 'Service'] };
export function composeEvidenceCoverage(context: ResolvedContext, query: string, language: ChatLanguageState) {
    const diagnostics = context.retrieval, needs = diagnostics?.coverage.map(row => row.need) ?? [];
    if (!diagnostics || needs.length < 2 || diagnostics.subjects.length > 1)
        return null;
    const guard = buildChatSafetyPlan(context, query, language);
    if (['resource', 'delivery', 'live_slots', 'relative_hours', 'conversation'].includes(guard.kind) || /\bfree\b|मुफ्त|निःशुल्क/iu.test(query))
        return null;
    const subject = diagnostics.subjects[0] ?? '';
    const parts: Array<{
        need: EvidenceNeed;
        state: string;
        text: string;
        sources: RetrievedChunk[];
    }> = [];
    let remaining = 7800;
    for (const need of needs) {
        const chunks = context.chunks.filter(chunk => chunkNeeds(chunk).includes(need));
        const conflicts = diagnostics.conflicts.filter(conflict => conflict.kind === need || chunks.some(chunk => conflict.sourceIds.includes(chunk.id)));
        const partContext = { ...context, chunks, retrieval: { ...diagnostics, conflicts } };
        const partQuery = need === 'price' ? `${subject} price?` : need === 'features' || need === 'process' ? subject || query : need === 'refund' ? 'Refund policy?' : need === 'cancellation' ? `${subject} cancellation policy?` : need === 'hours' ? 'Opening hours?' : need === 'booking' ? 'Is online booking available?' : `Is ${subject} available?`;
        const plan = buildChatSafetyPlan(partContext, partQuery, language);
        plan.leadOffer = false;
        if (plan.excerpts.length > 1)
            plan.excerpts = plan.excerpts.slice(0, 1);
        let text = composeSafeChatReply(plan), state = plan.state;
        let sources = plan.state.startsWith('known') ? [...plan.selected.map(f => f.chunk), ...plan.excerpts] : [];
        if (text.length > remaining) {
            state = 'unknown';
            sources = [];
            text = language.language === 'Hindi' ? 'इस हिस्से की पुष्टि नहीं कर सकता।' : language.language === 'Hinglish' ? 'Is hisse ki confirmed jaankari nahi de sakta.' : 'I cannot confirm this part here.';
        }
        const label = names[need][language.language === 'Hindi' ? 1 : language.language === 'Hinglish' ? 2 : 0];
        const piece = `${label}: ${text}`;
        remaining -= piece.length;
        parts.push({ need, state, text: piece, sources });
    }
    return { text: parts.map(p => p.text).join('\n\n'), complete: parts.every(p => p.state.startsWith('known')), parts, sources: [...new Map(parts.flatMap(p => p.sources).map(c => [c.id, c])).values()] };
}
