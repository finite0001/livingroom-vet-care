import { z } from "zod";

const phonePattern = /^\+[0-9 ().-]+$/;
const normalizedPhonePattern = /^\+[1-9][0-9]{7,14}$/;
const emailPattern = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const phoneSchema = z.string().trim()
  .min(1, "Phone number is required.")
  .max(50, "Phone must be 50 characters or fewer.")
  .refine(value => phonePattern.test(value) && normalizedPhonePattern.test(value.replace(/[ ().-]/g, "")), "Enter a valid phone number with a country code, such as +1 303 555 0100.")
  .transform(value => value.replace(/[ ().-]/g, ""));
const emailSchema = z.string().trim().toLowerCase()
  .min(1, "Email address is required.")
  .max(254, "Email must be 254 characters or fewer.")
  .refine(value => emailPattern.test(value) && !value.startsWith(".") && !value.includes("..") && !value.includes(".@"), "Enter a valid email address.");
const addressSchema = z.string().trim().max(1000, "Addresses must be 1,000 characters or fewer.").transform(value => value || null);
const clientFormSchema = z.object({
  first_name: z.string().trim().min(1, "First and last name are required.").max(100, "Names must be 100 characters or fewer."),
  last_name: z.string().trim().min(1, "First and last name are required.").max(100, "Names must be 100 characters or fewer."),
  primary_phone: phoneSchema,
  primary_email: emailSchema,
  preferred_channel: z.enum(["SMS", "EMAIL", "VOICE"]),
  mailing_address: addressSchema,
  housecall_address: addressSchema,
});

export interface ClientContacts {
  primary_phone: string | null;
  primary_email: string | null;
}

export function hasCompleteClientContacts(contacts: ClientContacts): boolean {
  return phoneSchema.safeParse(contacts.primary_phone).success && emailSchema.safeParse(contacts.primary_email).success;
}

export interface ClientFormValues {
  first_name: string;
  last_name: string;
  primary_phone: string;
  primary_email: string;
  preferred_channel: "SMS" | "EMAIL" | "VOICE";
  mailing_address: string;
  housecall_address: string;
}

export const emptyClientForm: ClientFormValues = {
  first_name: "", last_name: "", primary_phone: "", primary_email: "",
  preferred_channel: "SMS", mailing_address: "", housecall_address: "",
};

export function normalizeClientForm(values: ClientFormValues) {
  const result = clientFormSchema.safeParse(values);
  if (!result.success) throw new Error(result.error.issues[0].message);
  const { first_name, last_name, primary_phone, primary_email, preferred_channel, mailing_address, housecall_address } = result.data;
  return { first_name, last_name, primary_phone, primary_email, preferred_channel, mailing_address, housecall_address };
}

interface DuplicateCandidate {
  first_name: string;
  last_name: string;
  primary_phone: string | null;
  primary_email: string | null;
}

export function isPotentialDuplicate(values: DuplicateCandidate, candidate: DuplicateCandidate): boolean {
  const phone = (value: string | null) => value?.replace(/\D/g, "") || "";
  const email = (value: string | null) => value?.trim().toLowerCase() || "";
  return (
    (values.first_name.trim().toLowerCase() === candidate.first_name.trim().toLowerCase() &&
      values.last_name.trim().toLowerCase() === candidate.last_name.trim().toLowerCase()) ||
    (!!phone(values.primary_phone) && phone(values.primary_phone) === phone(candidate.primary_phone)) ||
    (!!email(values.primary_email) && email(values.primary_email) === email(candidate.primary_email))
  );
}
