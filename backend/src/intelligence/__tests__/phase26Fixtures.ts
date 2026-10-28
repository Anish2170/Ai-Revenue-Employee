import type { BusinessActionConfig } from '../../business-actions/action.types.js';
import type { ConversationStrategy } from '../conversationStrategy.js';
import type { StrategyKnowledgeResult } from '../knowledgeRetrieval.js';
import type { BusinessInstructions } from '../../context/types.js';

export const instructions: BusinessInstructions = { businessName: 'Example', language: 'English', tone: 'warm', alwaysBookDemo: false, avoidDiscounts: true, websiteUrl: 'https://example.test' };
export function knowledge(...content: string[]): StrategyKnowledgeResult { return { query: 'fixture', knowledgeAvailable: !!content.length, unavailableReason: null, scores: content.map(()=>0.9), chunks: content.map((text,i)=>({id:`source-${i}`,content:text,page:'/pricing',url:'https://example.test/pricing',pageType:'pricing',heading:'Plans',score:0.9})) }; }
export const businesses = [
  { id:'dental', topic:'your smile', detail:'your consultation options', title:'Your smile, your way.', goal:'book_appointment', kind:'BookAppointment', label:'Book Your Smile Consultation', actionId:'book_appointment', path:'/appointments' },
  { id:'clothing', topic:'your next style', detail:'your collection options', title:'A style that feels like you.', goal:'sell_products', kind:'Educate', label:'Explore Your Style', actionId:'view_collection', path:'/collection' },
  { id:'interiors', topic:'a warm home for your family', detail:'your interior design ideas', title:'Your space, your story.', goal:'book_appointment', kind:'BookAppointment', label:'Plan My Dream Home', actionId:'request_consultation', path:'/consultation' },
  { id:'restaurant', topic:'dinner with friends', detail:'your table options', title:'Your table, your way.', goal:'book_appointment', kind:'BookAppointment', label:'Reserve My Table', actionId:'reserve_table', path:'/reservations' },
  { id:'hotel', topic:'a calm escape', detail:'your stay options', title:'Your next chapter.', goal:'book_appointment', kind:'BookAppointment', label:'Find My Escape', actionId:'reserve_stay', path:'/booking' },
  { id:'saas', topic:'workflow options for your team', detail:'your workflow options', title:'Your workflow, your way.', goal:'book_demo', kind:'BookDemo', label:'Shape My Workflow', actionId:'book_demo', path:'/demo' },
  { id:'local-service', topic:'your next home project', detail:'your service options', title:'Your project, your way.', goal:'collect_lead', kind:'GenerateLead', label:'Let’s Talk About My Project', actionId:'contact_team', path:'/contact' },
] as const;
export function ownerAction(id:string, label:string, path:string): BusinessActionConfig { const destination = path.startsWith('http') || path.startsWith('javascript:') ? path : `https://example.test${path}`; return {actionId:id,label,destination,destinationType:'URL',enabled:true, authority:{source:'owner',websiteId:'tenant-a',actionId:id,label,destinationType:'URL',destination}} as BusinessActionConfig; }
export function strategy(kind: string, goal='collect_lead'): ConversationStrategy { return {kind,tone:'helpful',ctaIntent:'learn_more',reason:'labelled fixture',business:{objectiveKey:goal,isSupport:false,goalValue:0.7},visitor:{behaviour:{dominant:'Researching',trajectory:'flat'},intent:{goal:'Learn',readiness:'cold',conflict:false},confidence:{band:'high',score:0.9}}} as ConversationStrategy; }
export const validCopy: Array<{id:string;business:string;language:string;title:string;body:string;source:StrategyKnowledgeResult;supported?:boolean}> = businesses.flatMap(b => ['Thinking about','Curious about','Looking for'].map((prefix,i)=>({id:`${b.id}-${i}`,business:b.id,language:'English',title:b.title,body:`${prefix} ${b.topic}? Let's explore ${b.detail}.`,source:knowledge('Basic plan costs $10.')})));
validCopy.push(
 {id:'price-paraphrase-a',business:'saas',language:'English',title:'Your next step.',body:'For Basic plan, the price is $10.',source:knowledge('Basic plan costs $10.')},
 {id:'price-paraphrase-b',business:'saas',language:'English',title:'Your next step.',body:'Basic plan: $10. Want to compare your plan options?',source:knowledge('Basic plan costs $10.')},
 {id:'price-qualified',business:'saas',language:'English',title:'Your next step.',body:'Basic plan: $10 per month, billed annually. Want to compare your plan options?',source:knowledge('Basic plan costs $10 per month, billed annually.')},
 {id:'negative-policy',business:'clothing',language:'English',title:'Your next step.',body:'We do not offer refunds. Want to explore your collection options?',source:knowledge('Refunds are not available.')},
 {id:'hindi-home',business:'interiors',language:'Hindi',title:'आपका घर, आपकी कहानी।',body:'क्या आप अपने घर के डिज़ाइन पर बात करना चाहेंगे?',source:knowledge('Basic plan costs $10.')},
 {id:'hindi-smile',business:'dental',language:'Hindi',title:'आपकी मुस्कान।',body:'क्या आप अपनी मुस्कान के विकल्प देखना चाहेंगे?',source:knowledge('Basic plan costs $10.')},
 {id:'hinglish-home',business:'interiors',language:'Hinglish',title:'Aapka ghar, aapki kahaani.',body:'Apne ghar ke design par baat karna chahenge?',source:knowledge('Basic plan costs $10.')},
 {id:'hinglish-style',business:'clothing',language:'Hinglish',title:'Aapka style, aapki kahaani.',body:'Apne style ke options explore karna chahenge?',source:knowledge('Basic plan costs $10.')},
 {id:'french-style',business:'clothing',language:'French',title:'Votre style, votre histoire.',body:'Envie de découvrir votre style ?',source:knowledge('Basic plan costs $10.')},
 {id:'french-home',business:'interiors',language:'French',title:'Votre espace, votre histoire.',body:'Envie de découvrir votre décoration ?',source:knowledge('Basic plan costs $10.')},
 {id:'old-safe-invitation',business:'saas',language:'English',title:'Need help?',body:'Want help comparing plans?',source:knowledge('Basic plan costs $10.')},
 {id:'old-safe-fact',business:'saas',language:'English',title:'Need help?',body:'Basic plan costs $10.',source:knowledge('Basic plan costs $10.')},
);
// Held-out combinations were added after the initial policy, including genuine
// product-quality false positives that are deliberately NOT counted as accepted.
validCopy.push(
 {id:'holdout-clothing',business:'clothing',language:'English',title:'Your personal style.',body:"Considering your personal style and comfortable fabrics? Let's compare your collection options.",source:knowledge('Basic plan costs $10.')},
 {id:'holdout-interiors',business:'interiors',language:'English',title:'Spaces that tell your story.',body:"Dreaming of a timeless interior? Let's talk about your design ideas.",source:knowledge('Basic plan costs $10.')},
 {id:'holdout-restaurant',business:'restaurant',language:'English',title:'Your dinner, your way.',body:'Planning dinner with your family? What matters most to you?',source:knowledge('Basic plan costs $10.')},
 {id:'holdout-hotel',business:'hotel',language:'English',title:'Your next escape.',body:"Ready to explore your next stay? Let's compare your room options.",source:knowledge('Basic plan costs $10.')},
 {id:'holdout-saas',business:'saas',language:'English',title:'Your team, your story.',body:"Exploring software options for your team? Let's talk about your workflow ideas.",source:knowledge('Basic plan costs $10.')},
 {id:'holdout-local-service',business:'local-service',language:'English',title:'Your home project.',body:'Need help with your next home project? Shall we explore your service options?',source:knowledge('Basic plan costs $10.')},
 {id:'holdout-hindi',business:'interiors',language:'Hindi',title:'आपका घर।',body:'क्या आप अपने घर के विकल्प चुनना चाहेंगे?',source:knowledge('Basic plan costs $10.')},
 {id:'holdout-french',business:'clothing',language:'French',title:'Votre maison.',body:'Envie de comparer votre collection ?',source:knowledge('Basic plan costs $10.')},
 {id:'remaining-poetic',business:'clothing',language:'English',title:'Need help?',body:"Let's curate a silhouette as individual as you.",source:knowledge('Basic plan costs $10.'),supported:false},
 {id:'remaining-rhetorical',business:'interiors',language:'English',title:'Need help?',body:'A little clarity for a big decision?',source:knowledge('Basic plan costs $10.'),supported:false},
 {id:'remaining-next-chapter',business:'hotel',language:'English',title:'Need help?',body:'Ready for the next chapter?',source:knowledge('Basic plan costs $10.'),supported:false},
 {id:'remaining-number-words',business:'saas',language:'English',title:'Need help?',body:'Basic plan costs ten dollars per month.',source:knowledge('Basic plan costs $10 per month.'),supported:false},
 {id:'remaining-hindi-fact',business:'dental',language:'Hindi',title:'आपकी मुस्कान।',body:'परामर्श की कीमत ₹१० है।',source:knowledge('Consultation costs ₹10.'),supported:false},
 {id:'remaining-french-idiom',business:'interiors',language:'French',title:'Votre espace.',body:'Et si votre intérieur racontait votre histoire ?',source:knowledge('Basic plan costs $10.'),supported:false},
);
export const unsafeCopy = [
 'Basic plan costs $10. Premium plan costs $999.', 'Premium plan costs $10.', 'Refunds are available.',
 'Get a free consultation for dental implants.', 'Save 50% on your plan.', 'We guarantee perfect results.',
 'Delivery arrives tomorrow.', 'Your appointment is available today.', 'Your wallet can stay closed for this consultation.',
 'A smile with results you can count on, every single time.', 'Looking for guaranteed results?',
 'Thinking about a free consultation?', 'Want help with no-cost appointments?', 'Your risk disappears with our promise.',
 'Basic plan: $10. This applies to all plans.', 'Basic plan costs $10. Everything is included.',
 'क्या आप मुफ्त अपॉइंटमेंट चाहेंगे?', 'Apni guaranteed smile paana chahenge?', 'Votre consultation est gratuite.',
].map((body,i)=>({id:`unsafe-${i}`,language:i===16?'Hindi':i===17?'Hinglish':i===18?'French':'English',title:i===16?'क्या आपको मदद चाहिए?':i===17?'Kya aapko madad chahiye?':i===18?'Votre style, votre histoire.':'Need help?',body,source:knowledge('Basic plan costs $10.','Refunds are not available.')}));
export const validActions: Array<{id:string;action:BusinessActionConfig;kind:string;goal:string;supported?:boolean}> = businesses.map(b=>({id:b.id,action:ownerAction(b.actionId,b.label,b.path),kind:b.kind,goal:b.goal}));
validActions.push({id:'collection-brand',action:ownerAction('view_collection','Discover Our Collection','/collection'),kind:'Educate',goal:'sell_products'}, {id:'hindi-label',action:ownerAction('book_appointment','अपनी मुस्कान चुनें','/appointments'),kind:'BookAppointment',goal:'book_appointment'}, {id:'french-label',action:ownerAction('view_collection','Découvrez votre style','/collection'),kind:'Educate',goal:'sell_products'});
export const unsafeActions = [
 {id:'wrong-destination',action:ownerAction('pricing','Explore Your Style','/support'),kind:'ReducePriceAnxiety',goal:'collect_lead'},
 {id:'wrong-primary',action:ownerAction('support','Contact Support','/support'),kind:'ReducePriceAnxiety',goal:'collect_lead'},
 {id:'wrong-product-booking',action:ownerAction('book_demo','Book Demo','/demo'),kind:'Educate',goal:'sell_products'},
 {id:'unsafe-js',action:ownerAction('pricing','View Pricing','javascript:alert(1)'),kind:'ReducePriceAnxiety',goal:'collect_lead'},
 {id:'disabled',action:{...ownerAction('pricing','View Pricing','/pricing'),enabled:false},kind:'ReducePriceAnxiety',goal:'collect_lead'},
 {id:'claim-label',action:ownerAction('book_appointment','Get a Free Consultation','/appointments'),kind:'BookAppointment',goal:'book_appointment'},
 {id:'ambiguous',action:ownerAction('my_journey','Find My Escape','/go'),kind:'BookAppointment',goal:'book_appointment'},
];

validActions.push(
 {id:'remaining-owner-idiom',action:ownerAction('view_collection','Let’s Make It Yours','/collection'),kind:'Educate',goal:'sell_products',supported:false},
 {id:'remaining-owner-poetic',action:ownerAction('view_collection','Curate A Signature Look','/collection'),kind:'Educate',goal:'sell_products',supported:false},
 {id:'remaining-spanish-label',action:ownerAction('view_collection','Descubre tu estilo','/collection'),kind:'Educate',goal:'sell_products',supported:false},
);
unsafeActions.push(
 {id:'wallet-euphemism',action:ownerAction('book_appointment','Keep Your Wallet Closed','/appointments'),kind:'BookAppointment',goal:'book_appointment'},
 {id:'house-euphemism',action:ownerAction('book_appointment','Consultation On The House','/appointments'),kind:'BookAppointment',goal:'book_appointment'},
 {id:'results-euphemism',action:ownerAction('book_appointment','Our Results Never Let You Down','/appointments'),kind:'BookAppointment',goal:'book_appointment'},
);
