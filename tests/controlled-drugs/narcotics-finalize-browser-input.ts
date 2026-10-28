/** Private owner input. Credentials never enter initScript, HTML or URLs. */
import { z } from 'zod';
import { reviewUuidSchema } from '../../src/hub/features/controlled-drugs/record-review/request.ts';
import { narcoticsAuthenticatedInputSchema } from './narcotics-authenticated-input.ts';
export const narcoticsFinalizeBrowserInputSchema=z.object({
 origin:z.literal('http://127.0.0.1:64661'),anonKey:z.string().max(16384),actorId:reviewUuidSchema,
 scope:z.object({product_id:reviewUuidSchema,site_id:reviewUuidSchema}).strict(),countId:reviewUuidSchema,
 login:z.object({email:z.string().regex(/^lrv-closed-[a-f0-9]{16}-[01]@example\.invalid$/),password:z.string().regex(/^[A-Za-z0-9_-]{40}$/)}).strict(),
}).strict().superRefine((v,ctx)=>{if(!narcoticsAuthenticatedInputSchema.safeParse({origin:v.origin,anonKey:v.anonKey,actorId:v.actorId,scope:v.scope}).success)ctx.addIssue({code:'custom',message:'Fixed anonymous loopback configuration required'});});
export function narcoticsBrowserPublicInput(value:unknown){
 const v=narcoticsFinalizeBrowserInputSchema.parse(value);
 return narcoticsAuthenticatedInputSchema.parse({origin:v.origin,anonKey:v.anonKey,actorId:v.actorId,scope:v.scope});
}
