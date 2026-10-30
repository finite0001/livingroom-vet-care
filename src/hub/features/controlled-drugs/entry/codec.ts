import { decodeExactJson, ExactJsonNumber, validUnicode, type ExactJson } from "../record-review/exact-json.ts";
import { reviewJsonbTextBytes } from "../record-review/prepared-packet.ts";
import { readAdministrationResponse } from "../administration/response.ts";

export interface EntryObject { readonly [key: string]: ExactJson }
export function entryObject(value: unknown): EntryObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof ExactJsonNumber) throw new Error("A complete entry object is required.");
  return value as EntryObject;
}
/** Equality for intent delivery, not JSONB numeric equivalence: never silently
 * replace a caller's number token, UUID spelling, string or array order. */
export function sameEntryJson(left: unknown, right: unknown): boolean {
  let nodes=0;
  function same(a: unknown,b: unknown,depth:number):boolean {
    if (++nodes>100000||depth>64) throw new Error("Entry comparison exceeds its bound.");
    if(a instanceof ExactJsonNumber||b instanceof ExactJsonNumber)return a instanceof ExactJsonNumber&&b instanceof ExactJsonNumber&&a.token===b.token;
    if(a===null||b===null||typeof a!=="object"||typeof b!=="object")return a===b;
    if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>same(v,b[i],depth+1));
    const aa=a as Record<string,unknown>,bb=b as Record<string,unknown>,keys=Object.keys(aa);
    return keys.length===Object.keys(bb).length&&keys.every(k=>Object.prototype.hasOwnProperty.call(bb,k)&&same(aa[k],bb[k],depth+1));
  }
  return same(left,right,0);
}

/** Closed request serialization. Exact numeric tokens never use toJSON or
 * Number; plain protocol integers are only for newly constructed envelopes. */
export function serializeEntryJson(input: unknown, maximum=131072):string {
  let bytes=0,nodes=0;const chunks:string[]=[],ancestors=new Set<object>();
  const append=(text:string,cost:number)=>{if(cost>maximum-bytes)throw new Error("Entry request exceeds its byte limit.");bytes+=cost;chunks.push(text);};
  const string=(value:string)=>{
    if(value.length>maximum||!validUnicode(value)||value.includes("\0"))throw new Error("Entry text is invalid or too large.");
    // Bound escaping before allocating the encoded representation.
    let cost=2;
    for(let i=0;i<value.length;i++){
      const n=value.charCodeAt(i);
      if(n>=0xd800&&n<=0xdbff){i++;cost+=4;}
      else if(n===34||n===92||n===8||n===9||n===10||n===12||n===13)cost+=2;
      else if(n<32)cost+=6;else cost+=n<128?1:n<2048?2:3;
      if(cost>maximum-bytes)throw new Error("Entry request exceeds its byte limit.");
    }
    append(JSON.stringify(value),cost);
  };
  function visit(value:unknown,depth:number):void {
    if(++nodes>100000||depth>64)throw new Error("Entry request exceeds its structural bound.");
    if(value===null){append("null",4);return;}
    if(typeof value==="boolean"){append(value?"true":"false",value?4:5);return;}
    if(typeof value==="string"){string(value);return;}
    if(value instanceof ExactJsonNumber){
      if(Object.getPrototypeOf(value)!==ExactJsonNumber.prototype||Object.getOwnPropertyDescriptor(value,"token")?.value!==value.token)throw new Error("Exact entry number required.");
      append(value.token,value.token.length);return;
    }
    if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647&&!Object.is(value,-0)){append(String(value),String(value).length);return;}
    if(!value||typeof value!=="object"||ancestors.has(value))throw new Error("Entry request must be plain JSON.");
    const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
    if(proto!==(array?Array.prototype:Object.prototype)&&!(proto===null&&!array))throw new Error("Entry request must be plain JSON.");
    const keys=Reflect.ownKeys(value);if(keys.length>maximum||keys.some(k=>typeof k!=="string"))throw new Error("Entry keys exceed their bound.");
    ancestors.add(value);
    try{
      if(array){
        const length=Object.getOwnPropertyDescriptor(value,"length")?.value;
        if(!Number.isSafeInteger(length)||length<0||length>maximum/2||keys.length!==length+1)throw new Error("A dense entry array is required.");
        append("[",1);for(let i=0;i<length;i++){if(i)append(",",1);const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d?.enumerable||!("value"in d))throw new Error("Entry data properties required.");visit(d.value,depth+1);}append("]",1);
      }else{
        append("{",1);let index=0;
        for(const key of keys as string[]){if(index++)append(",",1);string(key);append(":",1);const d=Object.getOwnPropertyDescriptor(value,key);if(key==="toJSON"||!d?.enumerable||!("value"in d))throw new Error("Entry data properties required.");visit(d.value,depth+1);}append("}",1);
      }
    }finally{ancestors.delete(value);}
  }
  visit(input,0);return chunks.join("");
}
export function entryRequestBody(request:unknown,maximum=131072):string {
  const body=serializeEntryJson({p_request:request},maximum+128);
  const decoded=entryObject(decodeExactJson(new TextEncoder().encode(body)));
  if(reviewJsonbTextBytes(decoded.p_request)>maximum)throw new Error("Entry request exceeds its parsed limit.");
  return body;
}
/** Authentication is supplied by the entry client, never by this byte reader. */
export const readEntryResponse=readAdministrationResponse;
