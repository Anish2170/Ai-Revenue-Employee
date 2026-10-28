/** Conversational offers are multilingual; the optional form's interface stays English.
 * This bounded detector is not a replacement for a future structured lead-offer event. */
export function asksForLeadEmail(text: string): boolean {
  const value = text.normalize('NFKC').toLowerCase();
  if (/\b(no thanks|no thank you|not now|do not email|don't email|no need|nahi chahiye|nahin chahiye|email mat|mat bhej|abhi nahi)\b|(?:ईमेल|इमेल|मेल).{0,20}(?:नहीं|मत)|(?:नहीं चाहिए|अभी नहीं)/iu.test(value)) return false;
  return /\b(best email|email address|what(?:'s| is) your email|what(?:'s| is) the best email|email it|email this|email that|email it to you|email that to you|send .* email|send .* inbox)\b/iu.test(value)
    || /\b(?:apna|aapka|aapki|aapke|aap|kya|kaunsa|kis|konsa)\b.{0,50}\b(?:email|e-mail)\b.{0,45}\b(?:batayein|bataye|bataiye|batao|dein|dijiye|share|bhej|bhejein|bhejun|address|hai)\b/iu.test(value)
    || /(?:आप|अपना|आपका|आपकी|कौन|किस|क्या).{0,50}(?:ईमेल|इमेल|e-?mail).{0,45}(?:बताएं|बताइए|दीजिए|दें|भेज|पता|एड्रेस|साझा|है)/iu.test(value);
}
