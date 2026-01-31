const PurchaseSession = require("../models/PurchaseSession");
const PurchaseSessionItem = require("../models/PurchaseSessionItem");
const PurchaseLot = require("../models/PurchaseLot");
const Variant = require("../models/Variant");
const Supplier = require("../models/Supplier");
const { recalcVariantDailyPrice } = require("../services/pricingService");
const { getLastRefForVariant } = require("../services/refPriceService");
const mongoose = require("mongoose");

function emitSession(app, sessionId, event, payload) {
  const io = app.locals.io;
  if (!io) return;
  io.to(`session:${sessionId}`).emit(event, payload);
}

function isExpired(date) {
  return date && new Date(date).getTime() <= Date.now();
}

function normUnit(u) {
  const x = String(u || "").trim().toUpperCase();
  if (!x) return null;

  // compat legacy
  if (x === "UNID") return "UNIDAD";
  if (x === "BANDJ" || x === "BANDEJ") return "BANDEJA";

  return x;
}

function isValidPositiveNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

function pickFallbackBuyUnitFromVariant(variant) {
  // prioridad: unitBuy (si existe)
  const ub = normUnit(variant?.unitBuy);
  if (ub) return ub;

  // fallback: unitSale (sirve para planificar si no hay historial)
  const us = normUnit(variant?.unitSale);
  if (us) return us;

  return "KG";
}

async function addItem(req, res) {
  const { id: sessionId } = req.params;
  const {
    variantId,
    origin = "PLANIFICADO",
    plannedQty = null,
    refPrice = null,
    refBuyUnit = null, // ✅ opcional: si el front lo manda
  } = req.body || {};

  if (!variantId) return res.status(400).json({ ok: false, message: "variantId es requerido" });

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (!["PLANIFICACION", "ABIERTA"].includes(session.status)) {
    return res.status(409).json({ ok: false, message: "No se puede agregar ítems en una sesión cerrada" });
  }

  const variant = await Variant.findById(variantId).select("unitSale unitBuy");
  if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

  // 1) Normalizar inputs manuales
  const manualRefPrice = isValidPositiveNumber(refPrice) ? Number(refPrice) : null;
  const manualRefBuyUnit = normUnit(refBuyUnit);

  // 2) Si no vino refPrice, intentamos traer referencia histórica
  let finalRefPrice = manualRefPrice;
  let finalRefBuyUnit = manualRefBuyUnit;

  if (!finalRefPrice) {
    const lastRef = await getLastRefForVariant(variantId).catch(() => null);

    if (lastRef && isValidPositiveNumber(lastRef.refPrice)) {
      finalRefPrice = Number(lastRef.refPrice);
      finalRefBuyUnit = normUnit(lastRef.refBuyUnit);
    } else {
      finalRefPrice = null;
      finalRefBuyUnit = null;
    }
  }

  // 3) Fallback si sigue faltando unidad
  if (!finalRefBuyUnit) {
    finalRefBuyUnit = pickFallbackBuyUnitFromVariant(variant); // ✅ nunca null
  }

  try {
    const item = await PurchaseSessionItem.create({
      sessionId,
      variantId,
      origin,
      plannedQty,
      refPrice: finalRefPrice,     // ✅ puede ser null
      refBuyUnit: finalRefBuyUnit, // ✅ nunca ""
      state: "PENDIENTE",
    });

    emitSession(req.app, sessionId, "item_added", {
      itemId: item._id,
      variantId,
      origin,
      refPrice: item.refPrice,
      refBuyUnit: item.refBuyUnit,
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    if (err.code === 11000) {
      const existing = await PurchaseSessionItem.findOne({ sessionId, variantId });
      return res.status(409).json({
        ok: false,
        message: "La variante ya está en la lista de esta sesión",
        itemId: existing?._id,
      });
    }

    // ✅ devolver error real para debug (muy útil)
    const msg =
      err?.errors
        ? Object.values(err.errors).map((e) => e.message).join(" | ")
        : (err?.message || "Error agregando item");

    return res.status(500).json({ ok: false, message: msg });
  }
}

async function listItems(req, res) {
  const { id: sessionId } = req.params;

  const items = await PurchaseSessionItem.find({ sessionId })
    .populate({
      path: "variantId",
      populate: { path: "productId", select: "name imageUrl imagePublicId active updatedAt" },
      select: "nameVariant unitSale unitBuy imageUrl imagePublicId active productId updatedAt",
    })
    .populate("reservedBy", "username role")
    .sort({ createdAt: 1 });

  const lotsAgg = await PurchaseLot.aggregate([
    { $match: { sessionId: new mongoose.Types.ObjectId(sessionId) } },
    {
      $group: {
        _id: "$variantId",
        boughtQty: { $sum: "$qty" },
        boughtTotal: { $sum: { $multiply: ["$qty", "$unitCost"] } },
        lastBoughtAt: { $max: "$boughtAt" },
      },
    },
  ]);

  const lotMap = new Map();
  for (const row of lotsAgg) {
    lotMap.set(String(row._id), {
      boughtQty: Number(row.boughtQty || 0),
      boughtTotal: Number(row.boughtTotal || 0),
      lastBoughtAt: row.lastBoughtAt || null,
    });
  }

  const normalized = items.map((it) => {
    const obj = it.toObject();

    if (obj.state === "RESERVADO" && isExpired(obj.reserveExpiresAt)) {
      obj.state = "PENDIENTE";
      obj.reservedBy = null;
      obj.reserveExpiresAt = null;
    }

    const vId =
      obj?.variantId && typeof obj.variantId === "object"
        ? String(obj.variantId._id)
        : String(obj.variantId);

    obj.purchase = lotMap.get(vId) || { boughtQty: 0, boughtTotal: 0, lastBoughtAt: null };

    return obj;
  });

  return res.json({ ok: true, items: normalized });
}

async function removeItem(req, res) {
  const { id: sessionId, itemId } = req.params;

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede quitar ítems en sesión PLANIFICACION" });
  }

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  if (item.origin !== "PLANIFICADO") {
    return res.status(409).json({ ok: false, message: "Solo se pueden quitar ítems PLANIFICADOS desde planificación" });
  }

  if (item.state === "RESERVADO") return res.status(409).json({ ok: false, message: "No se puede quitar: RESERVADO" });
  if (item.state === "COMPRADO") return res.status(409).json({ ok: false, message: "No se puede quitar: COMPRADO" });
  if (item.state === "CANCELADO") return res.status(409).json({ ok: false, message: "No se puede quitar: CANCELADO" });

  await PurchaseSessionItem.deleteOne({ _id: itemId, sessionId });

  emitSession(req.app, sessionId, "item_removed", { itemId });
  return res.json({ ok: true, itemId });
}

async function updatePlanFields(req, res) {
  const { id: sessionId, itemId } = req.params;
  const { plannedQty, refPrice } = req.body || {};

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar planificación en sesión PLANIFICACION" });
  }

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  if (item.origin !== "PLANIFICADO") {
    return res.status(409).json({ ok: false, message: "Solo se pueden editar campos de planificación en ítems PLANIFICADOS" });
  }

  if (item.state !== "PENDIENTE") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar si el ítem está PENDIENTE" });
  }

  const update = {};

  if (plannedQty === "" || plannedQty === null || plannedQty === undefined) {
    update.plannedQty = null;
  } else {
    const q = Number(plannedQty);
    if (!Number.isFinite(q) || q <= 0) {
      return res.status(400).json({ ok: false, message: "plannedQty debe ser un número > 0 o vacío" });
    }
    update.plannedQty = q;
  }

  if (refPrice === "" || refPrice === null || refPrice === undefined) {
    update.refPrice = null;
  } else {
    const p = Number(refPrice);
    if (!Number.isFinite(p) || p <= 0) {
      return res.status(400).json({ ok: false, message: "refPrice debe ser un número > 0 o vacío" });
    }
    update.refPrice = p;
  }

  const updated = await PurchaseSessionItem.findByIdAndUpdate(itemId, update, { new: true });

  emitSession(req.app, sessionId, "item_plan_updated", {
    itemId: updated._id,
    plannedQty: updated.plannedQty,
    refPrice: updated.refPrice,
  });

  return res.json({ ok: true, item: updated });
}

async function reserveItem(req, res) {
  const { id: sessionId, itemId } = req.params;
  const { minutes } = req.body || {};
  const mins = Number(minutes);

  if (![10, 15, 30].includes(mins)) {
    return res.status(400).json({ ok: false, message: "minutes debe ser 10, 15 o 30" });
  }

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });
  if (session.status !== "ABIERTA") {
    return res.status(409).json({ ok: false, message: "Solo se puede reservar en sesión ABIERTA" });
  }

  const expiresAt = new Date(Date.now() + mins * 60 * 1000);

  const item = await PurchaseSessionItem.findOneAndUpdate(
    {
      _id: itemId,
      sessionId,
      state: { $in: ["PENDIENTE", "RESERVADO"] },
      $or: [
        { state: "PENDIENTE" },
        { state: "RESERVADO", reserveExpiresAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        state: "RESERVADO",
        reservedBy: req.user._id,
        reserveExpiresAt: expiresAt,
      },
    },
    { new: true }
  ).populate("reservedBy", "username role");

  if (!item) {
    return res.status(409).json({ ok: false, message: "No se pudo reservar (ya reservado por otra persona o no disponible)" });
  }

  emitSession(req.app, sessionId, "item_reserved", {
    itemId: item._id,
    reservedBy: item.reservedBy,
    reserveExpiresAt: item.reserveExpiresAt,
  });

  return res.json({ ok: true, item });
}

async function releaseItem(req, res) {
  const { id: sessionId, itemId } = req.params;

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  if (item.state !== "RESERVADO") {
    return res.status(409).json({ ok: false, message: "El ítem no está reservado" });
  }

  item.state = "PENDIENTE";
  item.reservedBy = null;
  item.reserveExpiresAt = null;
  await item.save();

  emitSession(req.app, sessionId, "item_released", { itemId: item._id });
  return res.json({ ok: true, item });
}

async function cancelItem(req, res) {
  const { id: sessionId, itemId } = req.params;

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  if (item.state === "COMPRADO") {
    return res.status(409).json({ ok: false, message: "No se puede cancelar un ítem ya comprado" });
  }

  item.state = "CANCELADO";
  item.reservedBy = null;
  item.reserveExpiresAt = null;
  await item.save();

  emitSession(req.app, sessionId, "item_cancelled", { itemId: item._id });
  return res.json({ ok: true, item });
}

/**
 * ✅ confirmItem ROBUSTO:
 * - buyUnit: prioridad Variant.unitBuy; fallback a item.refBuyUnit.
 * - CAJA: qty entero => N lotes qty=1
 * - resto: 1 lote qty decimal
 */
async function confirmItem(req, res) {
  const { id: sessionId, itemId } = req.params;
  const { supplierId, qty, unitCost } = req.body || {};

  if (!supplierId || qty == null || unitCost == null) {
    return res.status(400).json({ ok: false, message: "supplierId, qty y unitCost son requeridos" });
  }

  const q = Number(qty);
  const cost = Number(unitCost);

  if (!(q > 0) || !(cost > 0)) {
    return res.status(400).json({ ok: false, message: "qty y unitCost deben ser > 0" });
  }

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });
  if (session.status !== "ABIERTA") {
    return res.status(409).json({ ok: false, message: "Solo se puede confirmar compra en sesión ABIERTA" });
  }

  const supplier = await Supplier.findById(supplierId);
  if (!supplier || !supplier.active) {
    return res.status(404).json({ ok: false, message: "Proveedor no válido" });
  }

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });
  if (item.state === "CANCELADO") return res.status(409).json({ ok: false, message: "Ítem cancelado" });

  // ✅ Variante (preferimos unitBuy)
  const variant = await Variant.findById(item.variantId).select("unitBuy");
  if (!variant) return res.status(404).json({ ok: false, message: "Variante no encontrada" });

  // ✅ buyUnit robusto: Variant.unitBuy -> item.refBuyUnit
  const buyUnit = normUnit(variant.unitBuy) || normUnit(item.refBuyUnit);

  if (!buyUnit) {
    return res.status(400).json({
      ok: false,
      message: "No se puede confirmar: define unitBuy en la variante o define refBuyUnit en el ítem",
    });
  }

  const isCaja = buyUnit === "CAJA";

  let createdLots = [];

  if (isCaja) {
    if (!Number.isInteger(q)) {
      return res.status(400).json({
        ok: false,
        message: "Para CAJA la cantidad debe ser un entero (1, 2, 3...)",
      });
    }

    for (let i = 0; i < q; i++) {
      // eslint-disable-next-line no-await-in-loop
      const lot = await PurchaseLot.create({
        sessionId,
        variantId: item.variantId,
        supplierId,
        qty: 1,
        unitCost: cost,
        buyUnit,
        boughtBy: req.user._id,
        boughtAt: new Date(),
      });
      createdLots.push(lot);
    }
  } else {
    const lot = await PurchaseLot.create({
      sessionId,
      variantId: item.variantId,
      supplierId,
      qty: q,
      unitCost: cost,
      buyUnit,
      boughtBy: req.user._id,
      boughtAt: new Date(),
    });
    createdLots = [lot];
  }

  item.state = "COMPRADO";
  item.reservedBy = null;
  item.reserveExpiresAt = null;
  await item.save();

  const dailyPrice = await recalcVariantDailyPrice(sessionId, item.variantId);

  emitSession(req.app, sessionId, "item_confirmed", {
    itemId: item._id,
    lotIds: createdLots.map((l) => l._id),
  });

  emitSession(req.app, sessionId, "daily_price_updated", {
    sessionId,
    variantId: String(item.variantId),
    dailyPrice,
  });

  return res.json({ ok: true, item, lots: createdLots, dailyPrice });
}

async function updatePlannedQty(req, res) {
  const { id: sessionId, itemId } = req.params;
  const { plannedQty } = req.body || {};

  const n = Number(plannedQty);
  if (!Number.isFinite(n) || n <= 0) {
    return res.status(400).json({ ok: false, message: "plannedQty debe ser un número > 0" });
  }

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar cantidades en PLANIFICACION" });
  }

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  item.plannedQty = n;
  await item.save();

  emitSession(req.app, sessionId, "item_planned_qty_updated", { itemId, plannedQty: n });

  return res.json({ ok: true, item });
}

async function updateItem(req, res) {
  const { id: sessionId, itemId } = req.params;

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar ítems en PLANIFICACION" });
  }

  const item = await PurchaseSessionItem.findOne({ _id: itemId, sessionId });
  if (!item) return res.status(404).json({ ok: false, message: "Ítem no encontrado" });

  if (item.origin !== "PLANIFICADO") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar ítems PLANIFICADOS" });
  }

  const { plannedQty, refPrice, refBuyUnit } = req.body || {};

  if (plannedQty !== undefined) {
    if (plannedQty === null || plannedQty === "") item.plannedQty = null;
    else {
      const q = Number(plannedQty);
      if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ ok: false, message: "plannedQty inválido (>0)" });
      item.plannedQty = q;
    }
  }

  if (refPrice !== undefined) {
    if (refPrice === null || refPrice === "") item.refPrice = null;
    else {
      const p = Number(refPrice);
      if (!Number.isFinite(p) || p < 0) return res.status(400).json({ ok: false, message: "refPrice inválido (>=0)" });
      item.refPrice = p;
    }
  }

  if (refBuyUnit !== undefined) {
    item.refBuyUnit = refBuyUnit; // setter normaliza / convierte "" -> null
  }

  await item.save();

  emitSession(req.app, sessionId, "item_updated", {
    itemId: item._id,
    plannedQty: item.plannedQty,
    refPrice: item.refPrice,
    refBuyUnit: item.refBuyUnit ?? null,
  });

  return res.json({ ok: true, item });
}

module.exports = {
  addItem,
  listItems,
  reserveItem,
  releaseItem,
  cancelItem,
  confirmItem,
  removeItem,
  updatePlanFields,
  updatePlannedQty,
  updateItem,
};
