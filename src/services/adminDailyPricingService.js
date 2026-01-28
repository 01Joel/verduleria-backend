const DailyPrice = require("../models/DailyPrice");
const Variant = require("../models/Variant");
const PurchaseSessionItem = require("../models/PurchaseSessionItem");
const { getMarginPct, getRoundStep } = require("./configService");

function round2(n) {
  return Math.round(n * 100) / 100;
}

function ceilToStep(value, step) {
  const v = Number(value);
  const s = Number(step);
  if (!Number.isFinite(v)) return null;
  if (!Number.isFinite(s) || s <= 0) return v;
  return Math.ceil(v / s) * s;
}

// Normaliza strings de unidad (tu app mezcla UNID/UNIDAD)
function normUnit(u) {
  const x = String(u || "").trim().toUpperCase();
  if (x === "UNID") return "UNIDAD";
  return x;
}

/**
 * conversion (Number) en tu Variant:
 * - CAJA -> KG: conversion = kg_por_caja
 * - FARDO -> ATADO: conversion = atados_por_fardo
 * - BOLSA -> KG: conversion = kg_por_bolsa (si lo usas así)
 */
function convNumber(variant) {
  const n = Number(variant?.conversion);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Calcula costFinal normalizado a unitSale usando:
 * unitCostBuy = boughtTotal / boughtQty  (costo por unidad de compra)
 *
 * Retorna null si no se puede calcular por falta de conversion cuando es necesaria.
 */
function computeCostFinalFromItem({ variant, boughtQty, boughtTotal }) {
  const unitSale = normUnit(variant?.unitSale || "KG");
  const unitBuy = normUnit(variant?.unitBuy || "");
  const conversion = convNumber(variant);

  const q = Number(boughtQty);
  const t = Number(boughtTotal);

  if (!Number.isFinite(q) || q <= 0) return null;
  if (!Number.isFinite(t) || t <= 0) return null;

  const unitCostBuy = t / q; // costo por unidad de compra

  // si no hay unidad de compra definida, asumimos que unitCostBuy ya está en unitSale
  if (!unitBuy) return unitCostBuy;

  // MISMA UNIDAD -> directo
  if (unitSale === unitBuy) return unitCostBuy;

  // VENDO KG
  if (unitSale === "KG") {
    // compro CAJA/BOLSA/FARDO/ATADO y tengo conversion kg por unidad de compra
    if (["CAJA", "BOLSA", "FARDO", "ATADO"].includes(unitBuy)) {
      if (!conversion) return null;
      return unitCostBuy / conversion; // costo por KG
    }
    // compro UNIDAD y vendo KG => no soportado sin peso/unidad
    return null;
  }

  // VENDO ATADO
  if (unitSale === "ATADO") {
    // compro FARDO y conversion = atados_por_fardo
    if (unitBuy === "FARDO") {
      if (!conversion) return null;
      return unitCostBuy / conversion; // costo por ATADO
    }
    // otros combos no soportados aquí
    return null;
  }

  // VENDO UNIDAD
  if (unitSale === "UNIDAD") {
    // compro CAJA/BOLSA y conversion = unidades_por_caja/bolsa
    if (["CAJA", "BOLSA"].includes(unitBuy)) {
      if (!conversion) return null;
      return unitCostBuy / conversion; // costo por UNIDAD
    }
    // compro KG y vendo UNIDAD => no soportado sin peso/unidad
    return null;
  }

  // BANDJ/BOLSA como unitSale: si tú vendes por BOLSA/BANDJ, se maneja igual a unidad "misma unidad"
  // y si no coincide con unitBuy, no se calcula.
  return null;
}

/**
 * Upsert DailyPrice basado en PurchaseSessionItem (lo comprado).
 * Respeta MANUAL si ya está seteado.
 */
async function upsertDailyPriceFromItem({ sessionId, variantId }) {
  const marginPct = await getMarginPct();
  const roundStep = await getRoundStep();

  const variant = await Variant.findById(variantId)
    .select("unitSale unitBuy conversion productId nameVariant imageUrl imagePublicId updatedAt active")
    .populate("productId", "name imageUrl imagePublicId updatedAt active");

  if (!variant) return null;

  // item comprado
  const item = await PurchaseSessionItem.findOne({ sessionId, variantId }).select(
    "state purchase.boughtQty purchase.boughtTotal purchase.lastBoughtAt"
  );

  const boughtQty = item?.purchase?.boughtQty ?? 0;
  const boughtTotal = item?.purchase?.boughtTotal ?? 0;

  // si no está comprado, no listamos
  if (item?.state !== "COMPRADO" || Number(boughtQty) <= 0) return null;

  // si existe MANUAL, no recalculamos salePrice
  const existing = await DailyPrice.findOne({ sessionId, variantId }).select("pricingMode manualSalePrice");

  if (existing?.pricingMode === "MANUAL" && existing?.manualSalePrice != null) {
    const doc = await DailyPrice.findOneAndUpdate(
      { sessionId, variantId },
      {
        $set: {
          unitSale: variant.unitSale || "KG",
          marginPct,
          salePrice: existing.manualSalePrice,
          status: "LISTO",
        },
      },
      { upsert: true, new: true }
    );

    return {
      dailyPrice: doc,
      variant,
      purchase: { boughtQty, boughtTotal, lastBoughtAt: item?.purchase?.lastBoughtAt || null },
    };
  }

  const costFinal = computeCostFinalFromItem({ variant, boughtQty, boughtTotal });

  // si no se puede calcular => PARCIAL (se ve en admin, pero salePrice null)
  if (costFinal == null) {
    const doc = await DailyPrice.findOneAndUpdate(
      { sessionId, variantId },
      {
        $set: {
          unitSale: variant.unitSale || "KG",
          marginPct,
          costFinal: null,
          salePrice: null,
          status: "PARCIAL",
          pricingMode: "AUTO",
          manualSalePrice: null,
          manualSetBy: null,
          manualSetAt: null,
          manualNote: "",
          sourceLotId: null,
        },
      },
      { upsert: true, new: true }
    );

    return {
      dailyPrice: doc,
      variant,
      purchase: { boughtQty, boughtTotal, lastBoughtAt: item?.purchase?.lastBoughtAt || null },
    };
  }

  const salePriceBase = costFinal * (1 + marginPct);
  const salePrice = ceilToStep(salePriceBase, roundStep);

  const doc = await DailyPrice.findOneAndUpdate(
    { sessionId, variantId },
    {
      $set: {
        unitSale: variant.unitSale || "KG",
        marginPct,
        costFinal: round2(costFinal),
        salePrice: round2(salePrice),
        status: "LISTO",
        pricingMode: "AUTO",
        manualSalePrice: null,
        manualSetBy: null,
        manualSetAt: null,
        manualNote: "",
        sourceLotId: null,
      },
    },
    { upsert: true, new: true }
  );

  return {
    dailyPrice: doc,
    variant,
    purchase: { boughtQty, boughtTotal, lastBoughtAt: item?.purchase?.lastBoughtAt || null },
  };
}

/**
 * Lista mínima admin: SOLO lo comprado, con precio recalculado (AUTO)
 */
async function listAdminPurchasedWithPrices({ sessionId }) {
  // obtener variantIds comprados
  const items = await PurchaseSessionItem.find({ sessionId }).select("variantId state purchase.boughtQty");
  const boughtVariantIds = items
    .filter((it) => it?.state === "COMPRADO" && Number(it?.purchase?.boughtQty) > 0)
    .map((it) => it.variantId);

  const out = [];
  for (const variantId of boughtVariantIds) {
    // eslint-disable-next-line no-await-in-loop
    const row = await upsertDailyPriceFromItem({ sessionId, variantId });
    if (!row) continue;

    const { dailyPrice, variant, purchase } = row;

    out.push({
      _id: dailyPrice._id,
      sessionId,
      variantId: {
        _id: variant._id,
        productId: variant.productId,
        nameVariant: variant.nameVariant,
        unitSale: variant.unitSale,
        unitBuy: variant.unitBuy,
        conversion: variant.conversion ?? null,
        imageUrl: variant.imageUrl,
        imagePublicId: variant.imagePublicId,
        updatedAt: variant.updatedAt,
      },
      salePrice: dailyPrice.salePrice ?? null,
      unitSale: dailyPrice.unitSale,
      purchase,
    });
  }

  return out;
}

module.exports = {
  listAdminPurchasedWithPrices,
  upsertDailyPriceFromItem,
};
