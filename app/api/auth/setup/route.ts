import "server-only";
import { handler, requireUser, ApiError } from "@/lib/api/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { COUNTRIES } from "@/lib/countries";

export const dynamic = "force-dynamic";

interface Body {
  countryCode?: string;
  phoneCountryCode?: string;
  phoneNumber?: string;
  address?: string;
  /** Passing false saves progress without marking setup finished. */
  complete?: boolean;
}

/** What the account has, and whether setup is done. */
export const GET = handler(async (req: Request) => {
  const user = await requireUser(req);
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_storage")
    .select("country_code, phone_country_code, phone_number, address, setup_completed_at, display_name")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    countryCode: data?.country_code ?? null,
    phoneCountryCode: data?.phone_country_code ?? null,
    phoneNumber: data?.phone_number ?? null,
    address: data?.address ?? null,
    displayName: data?.display_name ?? null,
    completedAt: data?.setup_completed_at ?? null,
    isComplete: Boolean(data?.setup_completed_at),
  };
});

/**
 * Saves the account setup.
 *
 * Validated here rather than trusted from the form. The database has check
 * constraints for the same things, which is the floor — but a constraint
 * violation surfaces as a generic failure, and someone filling in a form deserves
 * to be told which field is wrong.
 *
 * The country has to be one we offer. Accepting any two letters would store
 * "ZZ" and leave every screen that resolves a country name showing nothing.
 */
export const PUT = handler(async (req: Request) => {
  const user = await requireUser(req);
  const body = (await req.json()) as Body;

  const country = COUNTRIES.find((c) => c.code === String(body.countryCode ?? "").toUpperCase());
  if (!country) throw new ApiError("INVALID_INPUT", 400, "Choose your country.");

  // The calling code is checked for shape but not forced to match the country:
  // +1 covers twenty countries, and people keep their number when they move.
  const dial = String(body.phoneCountryCode ?? country.dial).trim();
  if (!/^\+[0-9]{1,4}$/.test(dial)) {
    throw new ApiError("INVALID_INPUT", 400, "That country calling code does not look right.");
  }

  const phone = String(body.phoneNumber ?? "").trim();
  if (!/^[0-9 ()\-]{4,20}$/.test(phone)) {
    throw new ApiError("INVALID_INPUT", 400, "Enter a phone number.");
  }

  const address = String(body.address ?? "").trim();
  if (address.length < 1 || address.length > 500) {
    throw new ApiError("INVALID_INPUT", 400, "Enter your address.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_storage")
    .update({
      country_code: country.code,
      phone_country_code: dial,
      phone_number: phone,
      address,
      // Setting it again on a later edit is harmless and keeps the meaning
      // simple: the column says when the details were last confirmed complete.
      ...(body.complete === false ? {} : { setup_completed_at: new Date().toISOString() }),
    })
    .eq("user_id", user.id)
    .select("country_code, phone_country_code, phone_number, address, setup_completed_at")
    .single();
  if (error) throw error;

  return {
    countryCode: data.country_code,
    phoneCountryCode: data.phone_country_code,
    phoneNumber: data.phone_number,
    address: data.address,
    completedAt: data.setup_completed_at,
    isComplete: Boolean(data.setup_completed_at),
  };
});
