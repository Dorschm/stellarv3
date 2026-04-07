import { v4 as uuidv4 } from "uuid";

/**
 * Generate a deterministic anonymous display name from a random UUID.
 * Extracted from the former Lit-based UsernameInput element so the React
 * shell can use it without pulling in any `lit` dependency.
 */
export function genAnonUsername(): string {
  const uuid = uuidv4();
  const cleanUuid = uuid.replace(/-/g, "").toLowerCase();
  const decimal = BigInt(`0x${cleanUuid}`);
  const threeDigits = decimal % 1000n;
  return "Anon" + threeDigits.toString().padStart(3, "0");
}
