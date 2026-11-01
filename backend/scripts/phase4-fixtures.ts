/** Labelled fictional evaluation data. Gold URLs never enter the search query. */
import {createHash} from 'node:crypto';
import {extract} from '../src/crawler/extract.js';
import {buildChunks} from '../src/chunking/chunker.js';
import type {Chunk,CrawledPage} from '../src/context/types.js';
export interface Corpus {id:string;origin:string;pages:CrawledPage[];chunks:Chunk[];omitted:unknown[]}
export interface Case {id:string;tenant:string;query:string;language:'English'|'Hindi'|'Hinglish';group:string;split:'development'|'holdout';page?:string;history?:string[];purpose?:'popup';gold:string[][];conflict?:boolean;unknown?:boolean}
const specs:Record<string,Array<[string,string,string]>>={
 saas:[['/plans/basic','Basic plan','Basic plan costs ₹999 per month.'],['/plans/premium','Premium plan','Premium plan costs ₹2,499 per month.'],['/plans/plus','Premium Plus plan','Premium Plus plan costs ₹3,499 per month, billed annually.'],['/plans/premium/features','Premium plan','Premium plan includes analytics and priority support for product teams managing customer projects.'],['/policies/refund','Refund policy','Refunds are not available.'],['/policies/cancellation','Cancellation policy','Plan cancellations require 24 hours notice.'],...Array.from({length:4},(_,i)=>[`/faq/premium-${i}`,'Premium plan','Premium plan costs ₹2,499 per month.'] as [string,string,string])],
 dental:[['/cleaning','Dental cleaning','Dental cleaning starts at ₹1,200.'],['/root-canal','Root canal','Root canal treatment starts at ₹4,500.'],['/hours','Opening hours','The clinic opens Monday to Saturday, 9 AM to 7 PM.'],['/sunday','Sunday closure','The clinic is closed on Sunday.'],['/cancellation','Cancellation policy',"Appointment cancellations require 24 hours' notice."],['/refund','Consultation refund','Consultation fees are non-refundable.'],['/booking','Online booking','Online booking is available.'],['/emergency','Emergency treatment','Emergency dental treatment is not offered.']],
 restaurant:[['/menu/vegetarian','Vegetarian dinner','Vegetarian dinner costs ₹800 per person.'],['/menu/seafood','Seafood dinner','Seafood dinner costs ₹1,200 per person.'],['/hours','Opening hours','The restaurant opens Tuesday to Sunday, 12 PM to 10 PM.'],['/policies/cancellation','Cancellation policy','Table cancellations require 12 hours notice.']],
 clothing:[['/shirt?size=medium','Blue Medium Shirt','Blue Medium Shirt costs ₹1,800 per item, excluding delivery fees.'],['/shirt?size=large','Blue Large Shirt','Blue Large Shirt costs ₹2,000 per item, excluding delivery fees.'],['/policies/returns','Refund policy','Refunds are not available.']],
 interiors:[['/services/modular-kitchens','Modular kitchens','Modular kitchens follow a measurement visit, a written layout review and a separate installation appointment.'],['/services/luxury-bedrooms','Luxury bedrooms','Luxury bedrooms follow a lighting review, a materials discussion and a written installation scope.'],['/services/living-rooms','Living room design','Living room design starts with a furniture survey and layout consultation before the studio prepares a written design proposal.'],['/policies/cancellation','Cancellation policy','Design appointment cancellations require 48 hours notice.']],
 hotel:[['/rooms/standard','Standard room','Standard room costs $90 per night, excluding local taxes.'],['/rooms/deluxe','Deluxe room','Deluxe room costs $150 per night, excluding local taxes.'],['/policies/refund','Refund policy','Room fees are non-refundable.'],['/rooms/deluxe/features','Deluxe room','Deluxe room includes a balcony and a writing desk for visitors staying at the hotel.']],
 local:[['/services/plumbing','Plumbing visit','Plumbing visit starts at £75 per visit, excluding replacement parts.'],['/services/inspection','Drain inspection','Drain inspection starts at £95 per visit, excluding replacement parts.'],['/services/emergency','Emergency plumbing','Emergency plumbing is not offered.'],['/services/plumbing/process','Plumbing visit','The plumbing visit process starts with a visual inspection and a written explanation before the service team discusses possible repairs.']],
 conflict:[['/pricing','Premium plan','Premium plan costs ₹2,499 per month.'],['/blog/price','Premium plan','Premium plan costs ₹1,999 per month.'],['/services/emergency','Emergency treatment','Emergency treatment is not offered.'],['/blog/emergency','Emergency treatment','Emergency treatment is offered.']],
};
export const corpora:Corpus[]=Object.entries(specs).map(([id,rows])=>{
 const origin=`https://${id}-phase4.invalid`;
 const pages=rows.map(([path,title,content])=>{const html=`<!doctype html><html lang="en"><head><title>${title}</title></head><body><main><h1>${title}</h1><p>${content}</p></main></body></html>`,parsed=extract(html,origin+path);return {url:origin+path,path,title,text:parsed.text,sections:parsed.sections,pageType:(path.includes('polic')?'faq':path.includes('blog')?'blog':'services') as CrawledPage['pageType'],contentHash:createHash('sha256').update(parsed.text).digest('hex'),lastCrawled:'2026-10-27T00:00:00.000Z'};});
 const {chunks,omitted}=buildChunks(pages,'English');return {id,origin,pages,chunks,omitted};
});
const premium=['/plans/premium',...Array.from({length:4},(_,i)=>`/faq/premium-${i}`)];
export const cases:Case[]=[];
function add(id:string,tenant:string,query:string,gold:string[][],group='simple',extra:Partial<Case>={}){cases.push({id,tenant,query,gold,group,language:'English',split:'development',...extra});}
add('saas-price','saas','What is the Premium plan price?',[premium],'entity');
add('saas-plus','saas','What is the Premium Plus plan price?',[['/plans/plus']],'entity');
add('saas-page','saas','How much does this cost?',[premium],'page',{page:'/plans/premium?utm_source=ad'});
add('saas-switch','saas','Basic plan price?',[['/plans/basic']],'entity',{page:'/plans/premium',history:['Premium plan features?']});
add('saas-follow','saas','How much does it cost?',[premium],'followup',{history:['What does the Premium plan include?']});
add('saas-multi','saas','Premium plan price, features and refund policy?',[premium,['/plans/premium/features'],['/policies/refund']],'multipart');
add('saas-policy','saas','Premium plan refund policy?',[['/policies/refund']],'cross-page',{page:'/plans/premium'});
add('saas-compare','saas','Compare Basic and Premium plan prices',[['/plans/basic'],premium],'comparison',{split:'holdout'});
add('saas-hindi','saas','प्रीमियम प्लान की कीमत क्या है?',[premium],'entity',{language:'Hindi',split:'holdout'});
add('saas-unknown','saas','What is the Diamond plan price?',[],'unknown',{page:'/plans/premium',unknown:true});
for(const [lang,queries]of Object.entries({English:['What is the price of dental cleaning?','Is the clinic open on Sundays?','What is the cancellation policy?'],Hindi:['दांतों की सफाई कितने रुपये से शुरू होती है?','क्या क्लिनिक रविवार को खुला है?','अपॉइंटमेंट रद्द करने की क्या शर्त है?'],Hinglish:['Teeth cleaning kitne ka hai?','Sunday ko clinic open rehta hai?','Appointment cancel karne ka rule kya hai?']}))queries.forEach((q,i)=>add(`dental-${lang}-${i}`,'dental',q,[[['/cleaning','/sunday','/cancellation'][i]]],'multilingual',{language:lang as Case['language'],split:lang==='English'?'development':'holdout'}));
add('dental-refund','dental','Consultation fees refund hoti hai kya?',[['/refund']],'multilingual',{language:'Hinglish'});
add('dental-negative','dental','Emergency dental treatment milta hai kya?',[['/emergency']],'multilingual',{language:'Hinglish'});
add('dental-root','dental','Root canal ka starting price kya hai?',[['/root-canal']],'entity',{language:'Hinglish'});
add('dental-spelling','dental','Daanto ki safaai kitne rupay se shuru hoti hai?',[['/cleaning']],'multilingual',{language:'Hinglish',split:'holdout'});
add('dental-unknown','dental','Do you offer dental implants?',[],'unknown',{unknown:true});
add('dental-free','dental','Kya aap free consultation dete ho?',[],'unknown',{language:'Hinglish',unknown:true,split:'holdout'});
add('restaurant-price','restaurant','How much is the seafood dinner?',[['/menu/seafood']],'entity');
add('restaurant-page','restaurant','How much is this item?',[['/menu/vegetarian']],'page',{page:'/menu/vegetarian',split:'holdout'});
add('restaurant-policy','restaurant','What is the table cancellation policy?',[['/policies/cancellation']],'cross-page',{page:'/menu/seafood'});
add('clothing-page','clothing','How much is this item?',[['/shirt?size=large']],'page',{page:'/shirt?utm_source=ad&size=large'});
add('clothing-entity','clothing','Blue Medium Shirt price?',[['/shirt?size=medium']],'entity',{page:'/shirt?size=large',split:'holdout'});
add('clothing-policy','clothing','Can I get a refund?',[['/policies/returns']],'cross-page',{page:'/shirt?size=large'});
add('interiors-page','interiors','How does this service work?',[['/services/modular-kitchens']],'page',{page:'/services/modular-kitchens'});
add('interiors-explicit','interiors','Explain luxury bedrooms',[['/services/luxury-bedrooms']],'entity',{page:'/services/modular-kitchens'});
add('interiors-follow','interiors','What is the process?',[['/services/modular-kitchens']],'followup',{history:['Tell me about modular kitchens.']});
add('interiors-nav','interiors','How does this service work?',[['/services/living-rooms']],'page',{page:'/services/living-rooms',history:['Tell me about luxury bedrooms.'],split:'holdout'});
add('hotel-page','hotel','How much does this cost?',[['/rooms/deluxe']],'page',{page:'/rooms/deluxe'});
add('hotel-standard','hotel','Standard room price?',[['/rooms/standard']],'entity',{page:'/rooms/deluxe',split:'holdout'});
add('hotel-multi','hotel','Deluxe room price, features and refund policy?',[['/rooms/deluxe'],['/rooms/deluxe/features'],['/policies/refund']],'multipart',{split:'holdout'});
add('local-price','local','Plumbing visit price?',[['/services/plumbing']],'entity');
add('local-negative','local','Do you offer emergency plumbing?',[['/services/emergency']],'entity');
add('local-process','local','How does this service work?',[['/services/plumbing/process']],'page',{page:'/services/plumbing',split:'holdout'});
add('conflict-price','conflict','Premium plan price?',[['/pricing'],['/blog/price']],'conflict',{conflict:true});
add('conflict-service','conflict','Do you offer emergency treatment?',[['/services/emergency'],['/blog/emergency']],'conflict',{conflict:true,split:'holdout'});
add('popup-kitchen','interiors','EvaluatePrice service information high helpful',[['/services/modular-kitchens']],'popup',{purpose:'popup',page:'/services/modular-kitchens'});
add('popup-premium','saas','ReducePriceAnxiety pricing interest high reassuring',[premium],'popup',{purpose:'popup',page:'/plans/premium',split:'holdout'});
add('popup-appointment','dental','BookAppointment booking help high consultative',[['/booking']],'popup',{purpose:'popup',page:'/booking'});
// Validate labels against actual extracted/chunked evidence before any API call.
for(const testCase of cases){const corpus=corpora.find(c=>c.id===testCase.tenant)!;for(const group of testCase.gold)if(!group.some(path=>corpus.chunks.some(chunk=>chunk.url===corpus.origin+path)))throw Error(`Fixture missing actual Phase3 chunk: ${testCase.id} ${group}`);}
