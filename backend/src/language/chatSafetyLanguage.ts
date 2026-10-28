import type { ChatLanguage } from './chatLanguage.js';
/** Reviewed uncertainty wrappers for the existing language choices. Typed fact
 * realization is currently EN/HI/Hinglish; other languages retain exact source
 * quotations instead of releasing an unverifiable machine translation. */
const copy: Partial<Record<ChatLanguage, [string, string, string, string]>> = {
  French: ["Je n'ai pas d'information confirmée sur", 'Les sources se contredisent concernant', 'Pouvez-vous préciser votre question sur', 'Extrait exact de la source :'],
  Spanish: ['No tengo información confirmada sobre', 'Las fuentes se contradicen sobre', '¿Puede aclarar su pregunta sobre', 'Texto exacto de la fuente:'],
  German: ['Ich habe keine bestätigten Informationen zu', 'Die Quellen widersprechen sich zu', 'Bitte präzisieren Sie Ihre Frage zu', 'Wörtlicher Quellenauszug:'],
  Portuguese: ['Não tenho informação confirmada sobre', 'As fontes são contraditórias sobre', 'Pode esclarecer a sua pergunta sobre', 'Texto exato da fonte:'],
  Arabic: ['ليس لدي معلومات مؤكدة عن', 'المصادر متناقضة بشأن', 'يرجى توضيح سؤالك عن', 'النص الأصلي من المصدر:'],
  Bengali: ['এই বিষয়ে আমার কাছে নিশ্চিত তথ্য নেই:', 'এই বিষয়ে উৎসের তথ্য পরস্পরবিরোধী:', 'আপনার প্রশ্নটি আরও স্পষ্ট করুন:', 'উৎসের হুবহু লেখা:'],
  Tamil: ['இதுகுறித்து உறுதிப்படுத்தப்பட்ட தகவல் என்னிடம் இல்லை:', 'இதுகுறித்த ஆதாரங்களில் முரண்பாடு உள்ளது:', 'உங்கள் கேள்வைத் தெளிவுபடுத்தவும்:', 'ஆதாரத்தின் அசல் உரை:'],
  Telugu: ['దీని గురించి ధృవీకరించిన సమాచారం నా వద్ద లేదు:', 'దీని గురించి మూలాల్లో విరుద్ధ సమాచారం ఉంది:', 'దయచేసి మీ ప్రశ్నను స్పష్టం చేయండి:', 'మూలంలోని అసలు వచనం:'],
  Marathi: ['याबद्दल माझ्याकडे खात्रीशीर माहिती नाही:', 'याबद्दल स्रोतांमध्ये विरोधाभास आहे:', 'कृपया तुमचा प्रश्न स्पष्ट करा:', 'स्रोतातील मूळ मजकूर:'],
  Chinese: ['我没有以下事项的已确认信息：', '来源对此存在矛盾：', '请进一步说明您的问题：', '来源原文：'],
  Japanese: ['次の件について確認済みの情報がありません：', '次の件について情報源が矛盾しています：', '質問の内容を詳しく教えてください：', '情報源の原文：'],
  Korean: ['다음에 대한 확인된 정보가 없습니다:', '다음에 대한 출처 정보가 서로 다릅니다:', '질문을 구체적으로 알려 주세요:', '출처 원문:'],
};
export function safetyLanguageCopy(language: ChatLanguage): [string, string, string, string] | undefined { return copy[language]; }
