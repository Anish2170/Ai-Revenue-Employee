/** Visitor-authored workflow intent. Buying interest, page context and owner
 * sales goals cannot substitute for a visitor request to arrange follow-up. */
export function requestsContactCapture(query: string): boolean {
  const text = query.normalize('NFKC').toLowerCase();
  if (/\b(?:don't|do not|dont|no|not now|not interested)\b|नहीं|nahi/iu.test(text)) return false;
  return /\b(?:contact|email|call) me\b|\b(?:call ?back|follow[ -]?up)\b.*\b(?:please|me|want|need|request)\b|\b(?:please|me|want|need|request)\b.*\b(?:call ?back|follow[ -]?up)\b/iu.test(text)
    || /\b(?:i (?:want|need|would like) to|can (?:i|you)|please|request)\b.{0,50}\b(?:book|schedule|arrange)\b.{0,35}\b(?:appointment|consultation|demo|meeting|call|visit)\b/iu.test(text)
    || /^(?:please )?(?:book|schedule) (?:an? |my )?(?:appointment|consultation|demo|meeting|call|visit)\b/iu.test(text)
    || /\b(?:request|prepare|provide|send|want|need|like)\b.{0,35}\b(?:custom |personalized |a |an )?(?:quote|quotation|proposal|estimate)\b/iu.test(text)
    || /\b(?:mujhe|mere liye)\b.*\b(?:call|callback|followup|booking|book|consultation)\b/iu.test(text)
    || /मुझे.*(?:कॉल|संपर्क|बुक|परामर्श)/u.test(text);
}
export function voluntarilySharesContact(query: string, invited = false): boolean {
  if (/do not contact|don't contact|do not save|don't save|नहीं|nahi/iu.test(query)) return false;
  const hasContact = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|[+\d(][\d\s().-]{6,}/iu.test(query);
  const standalone = /^[\s+\d().-]{7,30}$|^[\w.+-]+@[\w.-]+\.[a-z]{2,}[.!]?$/iu.test(query.trim());
  return hasContact && (requestsContactCapture(query)
    || /^(?:my (?:email(?: address)?|phone(?: number)?|number)\s*(?:is\b|:)|mera (?:email|phone|number)\b|मेरा (?:ईमेल|फोन|नंबर))|\breach me at\b/iu.test(query)
    || invited && standalone);
}
