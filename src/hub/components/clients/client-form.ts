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
  const firstName = values.first_name.trim();
  const lastName = values.last_name.trim();
  const email = values.primary_email.trim().toLowerCase();
  if (!firstName || !lastName) throw new Error("First and last name are required.");
  if (firstName.length > 100 || lastName.length > 100) throw new Error("Names must be 100 characters or fewer.");
  if (values.primary_phone.trim().length > 50) throw new Error("Phone must be 50 characters or fewer.");
  if (email.length > 254) throw new Error("Email must be 254 characters or fewer.");
  if (values.mailing_address.trim().length > 1000 || values.housecall_address.trim().length > 1000) throw new Error("Addresses must be 1,000 characters or fewer.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return {
    first_name: firstName, last_name: lastName,
    primary_phone: values.primary_phone.trim() || null,
    primary_email: email || null,
    preferred_channel: values.preferred_channel,
    mailing_address: values.mailing_address.trim() || null,
    housecall_address: values.housecall_address.trim() || null,
  };
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
