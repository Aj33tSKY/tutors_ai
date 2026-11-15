/** GBP pence, matching how rates are stored in tutor_profiles.hourly_rate. Safe for browser bundles. */
export function gbp(pence: number) {
  return (pence / 100).toLocaleString("en-GB", { style: "currency", currency: "GBP" });
}
