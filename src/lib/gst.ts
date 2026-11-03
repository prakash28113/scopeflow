/** GST states and union territories (codes as in GSTINs), and the rules that pick the tax type. */

export const GST_STATES: [code: string, name: string][] = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"],
  ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"],
  ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"],
  ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"],
  ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
  ["97", "Other Territory"], ["96", "Outside India"],
];
/** Alphabetical, for pickers. */
export const GST_STATES_SORTED = [...GST_STATES].sort((a, b) => a[1].localeCompare(b[1]));

export const stateName = (code: string | null | undefined) => GST_STATES.find(([c]) => c === code)?.[1] ?? null;

/** The state a party is in: chosen, or the first two digits of their GSTIN. */
export function stateOf(p: { state_code?: string | null; gstin?: string | null } | null | undefined): string | null {
  if (!p) return null;
  if (p.state_code && stateName(p.state_code)) return p.state_code;
  const g = p.gstin?.slice(0, 2);
  return g && stateName(g) ? g : null;
}

/**
 * Place of supply for services and the tax type, as the database decides it:
 * the client's state when known, otherwise the business's; same state → CGST + SGST, otherwise IGST.
 */
export function supplyOf(seller: string | null, buyer: string | null) {
  const place = buyer ?? seller;
  return { place, split: Boolean(seller && place === seller) };
}

/** New accounts start with this SAC (IT design and development services); change it in Settings. */
export const DEFAULT_SAC = "998314";

/** Common SAC codes for freelance work (the freelancer can enter any other). */
export const SAC_SUGGESTIONS: [code: string, label: string][] = [
  ["998314", "IT design and development (websites, apps)"],
  ["998391", "Specialty design services (graphic, logo, interior…)"],
  ["998361", "Advertising services"],
  ["998399", "Other professional and technical services"],
  ["998222", "Business consulting"],
  ["999293", "Training and coaching"],
];
