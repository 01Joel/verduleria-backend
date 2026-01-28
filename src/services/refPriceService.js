const PurchaseLot = require("../models/PurchaseLot");
const DailyPrice = require("../models/DailyPrice");

/**
 * Obtiene referencia "D" (precio anterior) para una variante.
 * Prioridad:
 * 1) Último PurchaseLot histórico (compra real)
 * 2) Fallback: último DailyPrice con costFinal (si existe)
 */
async function getLastRefForVariant(variantId) {
  // 1) Último lote real
  const lastLot = await PurchaseLot.findOne({ variantId })
    .sort({ boughtAt: -1, createdAt: -1 })
    .select("unitCost buyUnit boughtAt");

  if (lastLot?.unitCost != null && lastLot?.buyUnit) {
    return {
      refPrice: Number(lastLot.unitCost),
      refBuyUnit: String(lastLot.buyUnit),
      source: "LOT",
      sourceAt: lastLot.boughtAt || lastLot.createdAt,
    };
  }

  // 2) Fallback: último dailyPrice con costo final
  const lastDp = await DailyPrice.findOne({
    variantId,
    costFinal: { $ne: null },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("costFinal unitSale updatedAt");

  if (lastDp?.costFinal != null) {
    // unitSale no es buyUnit, pero sirve como referencia si no hay historial de compra
    return {
      refPrice: Number(lastDp.costFinal),
      refBuyUnit: String(lastDp.unitSale || "KG"),
      source: "DAILYPRICE",
      sourceAt: lastDp.updatedAt || lastDp.createdAt,
    };
  }

  return {
    refPrice: null,
    refBuyUnit: null,
    source: "NONE",
    sourceAt: null,
  };
}

module.exports = { getLastRefForVariant };
