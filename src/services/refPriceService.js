const PurchaseLot = require("../models/PurchaseLot");
const DailyPrice = require("../models/DailyPrice");

function normUnit(u) {
  const x = String(u || "").trim().toUpperCase();
  if (!x) return null;

  // compat legacy
  if (x === "UNID") return "UNIDAD";
  if (x === "BANDJ" || x === "BANDEJ") return "BANDEJA";

  return x;
}

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
    .select("unitCost buyUnit boughtAt createdAt");

  if (lastLot?.unitCost != null && lastLot?.buyUnit) {
    const refPrice = Number(lastLot.unitCost);
    const refBuyUnit = normUnit(lastLot.buyUnit);

    if (Number.isFinite(refPrice) && refPrice > 0 && refBuyUnit) {
      return {
        refPrice,
        refBuyUnit,
        source: "LOT",
        sourceAt: lastLot.boughtAt || lastLot.createdAt,
      };
    }
  }

  // 2) Fallback: último dailyPrice con costo final
  const lastDp = await DailyPrice.findOne({
    variantId,
    costFinal: { $ne: null },
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .select("costFinal unitSale updatedAt createdAt");

  if (lastDp?.costFinal != null) {
    const refPrice = Number(lastDp.costFinal);
    const refBuyUnit = normUnit(lastDp.unitSale || "KG"); // fallback coherente

    if (Number.isFinite(refPrice) && refPrice > 0) {
      return {
        refPrice,
        refBuyUnit: refBuyUnit || "KG",
        source: "DAILYPRICE",
        sourceAt: lastDp.updatedAt || lastDp.createdAt,
      };
    }
  }

  return {
    refPrice: null,
    refBuyUnit: null,
    source: "NONE",
    sourceAt: null,
  };
}

module.exports = { getLastRefForVariant };
