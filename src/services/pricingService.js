const PurchaseLot = require("../models/PurchaseLot");
const DailyPrice = require("../models/DailyPrice");
const Variant = require("../models/Variant");
const { getMarginPct, getRoundStep } = require("./configService");

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ceilToStep(value) {
  const v = Number(value);
  if (!isFinite(v)) return null;
  /*const v = Number(value);
  const s = Number(step);

  if (!Number.isFinite(v)) return null;
  if (!Number.isFinite(s) || s <= 0) return v;
  return Math.ceil(v / s) * s;*/
  return Math.floor((v+50)/100)*100;
}

function normUnit(u) {
  const x = String(u || "").trim().toUpperCase();
  if (x === "UNID") return "UNIDAD";
  if (x === "BANDJ" || x === "BANDEJ") return "BANDEJA";
  return x;
}

function convNumber(variant) {
  const n = Number(variant?.conversion);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Normaliza el costo de un lote a la unidad de venta de la variante.
 * Devuelve costo "por unitSale".
 *
 * ✅ Reglas:
 * - Si no se puede convertir => null (PARCIAL)
 * - Si hay netWeightKg (pesaje real) y aplica, tiene prioridad.
 */
function normalizedCost(lot, variant) {
  const unitSale = normUnit(variant?.unitSale || "KG");
  const buyUnit = normUnit(lot?.buyUnit || variant?.unitBuy || "");

  const conversion = convNumber(variant); // Number

  // -------------------------
  // VENTA: KG
  // -------------------------
  if (unitSale === "KG") {
    if (buyUnit === "KG") return lot.unitCost;

    // CAJA/BOLSA/FARDO/ATADO -> KG
    if (["CAJA", "BOLSA", "FARDO", "ATADO"].includes(buyUnit)) {
      // prioridad: pesaje real si existe (kg por esa unidad comprada)
      const w = Number(lot.netWeightKg);
      if (Number.isFinite(w) && w > 0) return lot.unitCost / w;

      // fallback: conversion = kg_por_unidad_compra
      if (conversion) return lot.unitCost / conversion;

      return null;
    }

    // UNIDAD -> KG (no soportado sin peso/unidad)
    return null;
  }

  // -------------------------
  // VENTA: UNIDAD
  // -------------------------
  if (unitSale === "UNIDAD") {
    if (buyUnit === "UNIDAD") return lot.unitCost;

    // CAJA/BOLSA -> UNIDAD (conversion = unidades_por_unidad_compra)
    if (["CAJA", "BOLSA"].includes(buyUnit)) {
      if (!conversion) return null;
      return lot.unitCost / conversion;
    }

    // KG -> UNIDAD (no soportado)
    return null;
  }

  // -------------------------
  // VENTA: ATADO
  // -------------------------
  if (unitSale === "ATADO") {
    if (buyUnit === "ATADO") return lot.unitCost;

    // FARDO -> ATADO (conversion = atados_por_fardo)
    if (buyUnit === "FARDO") {
      if (!conversion) return null;
      return lot.unitCost / conversion;
    }

    return null;
  }

  // -------------------------
  // VENTA: BOLSA / BANDJ (si vendés así)
  // Solo soportamos directo si coincide la compra
  // -------------------------
  if (unitSale === "BOLSA" || unitSale === "BANDEJA") {
    // directo si coincide la compra
    if (buyUnit === unitSale) return lot.unitCost;

    // opcional: permitir CAJA -> BANDEJA con conversion (bandejas por caja)
    if (buyUnit === "CAJA") {
      if (!conversion) return null;
      return lot.unitCost / conversion;
    }

    return null;
  }
}

function pickFinalLot(lots, variant) {
  let best = null;

  for (const lot of lots) {
    const cost = normalizedCost(lot, variant);
    if (cost == null) continue;

    const t = (lot.weighedAt || lot.boughtAt || lot.createdAt || new Date(0)).getTime();

    if (!best) {
      best = { lot, cost, t };
      continue;
    }

    // Híbrido: mayor costo manda; empate -> más reciente
    if (cost > best.cost) best = { lot, cost, t };
    else if (cost === best.cost && t >= best.t) best = { lot, cost, t };
  }

  return best;
}

async function getLastManualSalePriceForVariant(variantId, { excludeSessionId } = {}) {
  const q = {
    variantId,
    pricingMode: "MANUAL",
    manualSalePrice: { $ne: null },
  };
  if (excludeSessionId) q.sessionId = { $ne: excludeSessionId };

  const last = await DailyPrice.findOne(q)
    .sort({ manualSetAt: -1, updatedAt: -1 })
    .select("manualSalePrice manualSetAt salePrice");

  return last?.manualSalePrice ?? last?.salePrice ?? null;
}

async function setManualDailyPrice({ sessionId, variantId, salePrice, userId, note = "" }) {
  const variant = await Variant.findById(variantId).select("unitSale");
  const unitSale = variant?.unitSale || "KG";

  const n = Number(salePrice);
  if (!Number.isFinite(n) || n <= 0) {
    const err = new Error("salePrice inválido");
    err.statusCode = 400;
    throw err;
  }

  const doc = await DailyPrice.findOneAndUpdate(
    { sessionId, variantId },
    {
      $set: {
        unitSale,
        pricingMode: "MANUAL",
        manualSalePrice: round2(n),
        salePrice: round2(n),
        manualSetBy: userId || null,
        manualSetAt: new Date(),
        manualNote: String(note || ""),
        status: "LISTO",
      },
    },
    { upsert: true, new: true }
  );

  return doc;
}

async function recalcVariantDailyPrice(sessionId, variantId) {
  const marginPct = await getMarginPct();
  const roundStep = await getRoundStep();

  // ✅ ahora conversion es Number
  const variant = await Variant.findById(variantId).select("unitSale unitBuy conversion");
  const unitSale = variant?.unitSale || "KG";

  // ✅ si está MANUAL, respetar
  const existing = await DailyPrice.findOne({ sessionId, variantId }).select("pricingMode manualSalePrice");
  if (existing?.pricingMode === "MANUAL" && existing?.manualSalePrice != null) {
    const doc = await DailyPrice.findOneAndUpdate(
      { sessionId, variantId },
      { $set: { unitSale, marginPct, salePrice: existing.manualSalePrice, status: "LISTO" } },
      { new: true }
    );
    return doc;
  }

  const lots = await PurchaseLot.find({ sessionId, variantId }).sort({ boughtAt: 1, createdAt: 1 });

  let status = lots.length > 0 ? "PARCIAL" : "PENDIENTE";
  const picked = pickFinalLot(lots, variant);

  if (!picked) {
    const doc = await DailyPrice.findOneAndUpdate(
      { sessionId, variantId },
      {
        $set: {
          unitSale,
          marginPct,
          costFinal: null,
          salePrice: null,
          status,
          sourceLotId: null,
          pricingMode: "AUTO",
          manualSalePrice: null,
          manualSetBy: null,
          manualSetAt: null,
          manualNote: "",
        },
      },
      { upsert: true, new: true }
    );
    return doc;
  }

  const costFinal = picked.cost;
  const salePriceBase = costFinal * (1 + marginPct);
  const salePrice = ceilToStep(salePriceBase);

  const doc = await DailyPrice.findOneAndUpdate(
    { sessionId, variantId },
    {
      $set: {
        unitSale,
        marginPct,
        costFinal: round2(costFinal),
        salePrice: round2(salePrice),
        status: "LISTO",
        sourceLotId: picked.lot._id,
        pricingMode: "AUTO",
        manualSalePrice: null,
        manualSetBy: null,
        manualSetAt: null,
        manualNote: "",
      },
    },
    { upsert: true, new: true }
  );

  return doc;
}

async function recalcAllDailyPricesForSession(sessionId) {
  const distinct = await PurchaseLot.distinct("variantId", { sessionId });
  for (const variantId of distinct) {
    // eslint-disable-next-line no-await-in-loop
    await recalcVariantDailyPrice(sessionId, variantId);
  }
}

module.exports = {
  recalcVariantDailyPrice,
  recalcAllDailyPricesForSession,
  setManualDailyPrice,
  getLastManualSalePriceForVariant,
};
