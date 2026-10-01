// Offre cadeau (Google Play « developer determined ») : recherche de l'option et calcul des prix affichés.
import Purchases from "react-native-purchases";
import { configurePurchases } from "./purchases";

export type GiftPricing = {
  giftPrice: string; // prix de la 1re année (ex. "24,99 €")
  fullPrice: string; // prix annuel normal (ex. "49,99 €")
  perMonth: string; // équivalent mensuel de la 1re année (ex. "2,08 €")
  discount: number; // pourcentage de remise (ex. 50)
};

// Option d'abonnement correspondant à l'offre, trouvée par son identifiant ("yearly:cadeau-50") ou son tag
export function findGiftOption(product: any, offerId: string): any | null {
  const options: any[] = product?.subscriptionOptions ?? [];
  return (
    options.find(
      (o) =>
        (typeof o?.id === "string" && o.id.endsWith(`:${offerId}`)) ||
        (Array.isArray(o?.tags) && o.tags.includes(offerId))
    ) ?? null
  );
}

function formatMoney(value: number, currency: string) {
  try {
    return value.toLocaleString("fr-FR", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `${value.toFixed(2)} €`;
  }
}

// Prix réels de l'offre cadeau depuis le store, ou null si l'offre n'est pas disponible
export async function loadGiftPricing(offerId: string): Promise<GiftPricing | null> {
  try {
    configurePurchases();
    const offerings = await Purchases.getOfferings();
    const pkg = offerings.current?.availablePackages.find((p) => p.packageType === "ANNUAL");
    if (!pkg) return null;

    const option = findGiftOption(pkg.product, offerId);
    const phase = option ? option.introPhase ?? option.pricingPhases?.[0] ?? null : null;
    const micros = Number(phase?.price?.amountMicros ?? 0);
    if (!micros) return null;

    const product: any = pkg.product;
    const currency = product.currencyCode ?? "EUR";
    const giftValue = micros / 1_000_000;
    const fullValue = typeof product.price === "number" ? product.price : null;

    return {
      giftPrice: phase.price.formatted ?? formatMoney(giftValue, currency),
      fullPrice: product.priceString,
      perMonth: formatMoney(giftValue / 12, currency),
      discount: fullValue ? Math.round((1 - giftValue / fullValue) * 100) : 0,
    };
  } catch (e) {
    console.warn("loadGiftPricing échoué:", e);
    return null;
  }
}