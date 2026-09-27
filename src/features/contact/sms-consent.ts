// Carrier-reviewed A2P 10DLC opt-in disclosure. The database stores its own
// copy (public.contact_sms_consent_disclosure()); tests keep the two identical.
export const SMS_CONSENT_LEAD =
  "I agree to receive text messages from The Living Room Vet at the phone number provided, including appointment reminders, visit follow-ups, prescription notices, and replies to my questions. Message frequency varies. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of service. See our ";
export const SMS_CONSENT_PRIVACY_LABEL = "Privacy Policy";
export const SMS_CONSENT_PRIVACY_PATH = "/privacy#text-messages";
export const SMS_CONSENT_TERMS_LABEL = "Terms";
export const SMS_CONSENT_TERMS_PATH = "/terms#text-message-program";
export const SMS_CONSENT_DISCLOSURE = `${SMS_CONSENT_LEAD}${SMS_CONSENT_PRIVACY_LABEL} and ${SMS_CONSENT_TERMS_LABEL}.`;
export const SMS_CONSENT_PHONE_REQUIRED = "Enter a mobile number to receive texts";

export interface SmsConsentFields {
  phone: string;
  sms_consent: boolean;
}

// Returns the phone-field error for consent without a number, else null.
export function smsConsentPhoneError(fields: SmsConsentFields): string | null {
  return fields.sms_consent && !fields.phone.trim()
    ? SMS_CONSENT_PHONE_REQUIRED
    : null;
}
