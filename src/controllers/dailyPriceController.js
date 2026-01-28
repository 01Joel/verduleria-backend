const mongoose = require("mongoose");
const DailyPrice = require("../models/DailyPrice");
const { setManualDailyPrice, getLastManualSalePriceForVariant, recalcAllDailyPricesForSession } = require("../services/pricingService");
const PurchaseLot = require("../models/PurchaseLot");
const PurchaseSessionItem = require("../models/PurchaseSessionItem");
const PurchaseSession = require("../models/PurchaseSession");
const Variant = require("../models/Variant");


// GET /daily-prices?sessionId=...&onlyReady=true|false&includeCosts=true|false
async function listDailyPrices(req, res) {
  try {
    const { sessionId } = req.query;
    const onlyReady = String(req.query.onlyReady ?? "true") === "true";
    const includeCostsRequested = String(req.query.includeCosts ?? "false") === "true";

    if (!sessionId) {
      return res.status(400).json({ ok: false, message: "sessionId es requerido" });
    }
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, message: "sessionId inválido" });
    }

    const isAdmin = req.user?.role === "ADMIN";
    const includeCosts = isAdmin && includeCostsRequested;

    // ✅ sesión actual (para buscar la anterior)
    const currentSession = await PurchaseSession.findById(sessionId).select("dateKey dateTarget");
    if (!currentSession) {
      return res.status(404).json({ ok: false, message: "Sesión no encontrada" });
    }

    const filter = { sessionId };

    // ✅ VENDEDOR: por defecto solo LISTO + salePrice != null
    if (!isAdmin && onlyReady) {
      filter.status = "LISTO";
      filter.salePrice = { $ne: null };
    }

    let query = DailyPrice.find(filter).populate({
      path: "variantId",
      select: "nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt productId",
      populate: { path: "productId", select: "name imageUrl imagePublicId updatedAt" },
    });

    if (includeCosts) {
      query = query.populate(
        "sourceLotId",
        "buyUnit unitCost netWeightKg supplierId boughtAt weighedAt createdAt"
      );
    }

    const todayDocs = await query.sort({ updatedAt: -1 });

    // ✅ buscar sesión anterior por dateTarget
  const prevSession = await PurchaseSession.find({
    dateTarget: { $lt: currentSession.dateTarget },
  })
    .sort({ dateTarget: -1 })
    .limit(1)
    .select("_id dateKey dateTarget")
    .lean()
    .then(r => r[0] || null);
  
    // ✅ mapear prevSalePrice por variantId
    const prevMap = new Map();
    if (prevSession && todayDocs.length > 0) {
      const variantIds = todayDocs
        .map((d) => (d.variantId && typeof d.variantId === "object" ? d.variantId._id : d.variantId))
        .filter(Boolean);

      const prevDocs = await DailyPrice.find({
        sessionId: prevSession._id,
        variantId: { $in: variantIds },
        salePrice: { $ne: null },
      }).select("variantId salePrice");

      for (const p of prevDocs) {
        prevMap.set(String(p.variantId), Number(p.salePrice));
      }
    }

    const out = todayDocs.map((doc) => {
      const obj = doc.toObject();

      const vId =
        obj?.variantId && typeof obj.variantId === "object"
          ? String(obj.variantId._id)
          : String(obj.variantId);

      const today = obj.salePrice == null ? null : Number(obj.salePrice);
      const prev = prevMap.has(vId) ? prevMap.get(vId) : null;

      let movement = "NEW";
      let delta = null;

      if (today != null && prev != null) {
        const d = today - prev;
        delta = d;

        if (d > 0) movement = "UP";
        else if (d < 0) movement = "DOWN";
        else movement = "SAME";
      }

      obj.movement = movement;             // "UP" | "DOWN" | "SAME" | "NEW"
      obj.delta = delta;                   // number | null
      obj.prevSalePrice = prev;            // number | null
      obj.prevDateKey = prevSession ? prevSession.dateKey : null;

      // ✅ sanitizar para vendedor (no costos)
      if (!includeCosts) {
        delete obj.costFinal;
        delete obj.marginPct;
        delete obj.sourceLotId;
        delete obj.manualSalePrice;
        delete obj.manualSetBy;
        delete obj.manualSetAt;
        delete obj.manualNote;
        delete obj.pricingMode;
      }

      return obj;
    });

    return res.json({ ok: true, prices: out });
  } catch (err) {
  console.error("listDailyPrices error:", err);
  return res.status(500).json({
    ok: false,
    message: "Error listando precio del dia",
    error: err?.message || String(err),
  });
  
  /*catch (err) {
    console.error("listDailyPrices error:", err);
    return res.status(500).json({ ok: false, message: "Error listando precio del dia" });*/
  }
}




// GET /daily-prices/:id
async function getDailyPrice(req, res) {
  const { id } = req.params;

  const price = await DailyPrice.findById(id)
    .populate({
      path: "variantId",
      select: "nameVariant unitSale conversion imageUrl imagePublicId updatedAt productId",
      populate: { path: "productId", select: "name imageUrl imagePublicId updatedAt" },
    })
    .populate("sourceLotId", "buyUnit unitCost netWeightKg supplierId boughtAt weighedAt createdAt");

  if (!price) {
    return res.status(404).json({ ok: false, message: "DailyPrice no encontrado" });
  }

  // Si no es admin, ocultar costos
  const isAdmin = req.user?.role === "ADMIN";
  if (!isAdmin) {
    const obj = price.toObject();
    delete obj.costFinal;
    delete obj.marginPct;
    delete obj.sourceLotId;
    delete obj.manualSalePrice;
    delete obj.manualSetBy;
    delete obj.manualSetAt;
    delete obj.manualNote;
    delete obj.pricingMode;
    return res.json({ ok: true, price: obj });
  }

  return res.json({ ok: true, price });
}

/**
 * GET /daily-prices/pending?sessionId=...
 * Devuelve los DailyPrice PARCIAL/PENDIENTE + sugerencia de último precio manual por variante.
 */
async function listPendingPrices(req, res) {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  }

  const pending = await DailyPrice.find({
    sessionId,
    status: { $in: ["PENDIENTE", "PARCIAL"] },
  })
    .populate({
      path: "variantId",
      select: "nameVariant unitSale conversion imageUrl imagePublicId updatedAt productId",
      populate: { path: "productId", select: "name imageUrl imagePublicId updatedAt" },
    })
    .sort({ updatedAt: -1 });

  const enriched = [];
  for (const p of pending) {
    // eslint-disable-next-line no-await-in-loop
    const lastManual = await getLastManualSalePriceForVariant(p.variantId?._id, { excludeSessionId: sessionId });
    enriched.push({
      ...p.toObject(),
      lastManualSalePrice: lastManual,
    });
  }

  // Solo admin debería ver esto en producción (opcional). Si quieres, lo cierro por rol.
  return res.json({ ok: true, pending: enriched });
}

/**
 * PATCH /daily-prices/:id/manual
 * Body: { salePrice, note }
 */
async function setManualPrice(req, res) {
  const { id } = req.params;
  const { salePrice, note = "" } = req.body || {};

  const dp = await DailyPrice.findById(id).select("sessionId variantId");
  if (!dp) return res.status(404).json({ ok: false, message: "DailyPrice no encontrado" });

  const doc = await setManualDailyPrice({
    sessionId: dp.sessionId,
    variantId: dp.variantId,
    salePrice,
    userId: req.user?._id,
    note,
  });

  return res.json({ ok: true, price: doc });
}
async function recalcSessionDailyPrices(req, res) {
  const { sessionId } = req.query;

  if (!sessionId) {
    return res.status(400).json({ ok: false, message: "sessionId es requerido" });
  }

  await recalcAllDailyPricesForSession(sessionId);

  return res.json({ ok: true });
}
async function listDailyPriceBoard(req, res) {
  try {
    const { sessionId } = req.query;

    if (!sessionId) return res.status(400).json({ ok: false, message: "sessionId es requerido" });
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ ok: false, message: "sessionId inválido" });
    }

    // Validar sesión existe
    const currentSession = await PurchaseSession.findById(sessionId).select("_id dateKey dateTarget status");
    if (!currentSession) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

    // 1) Catálogo completo (variantes activas)
    const variants = await Variant.find({ active: true })
      .select("nameVariant unitSale unitBuy conversion imageUrl imagePublicId updatedAt productId")
      .populate({ path: "productId", select: "name category imageUrl imagePublicId updatedAt active" })
      .lean();

    // 2) Precios de HOY (sesión actual)
    const todayDocs = await DailyPrice.find({
      sessionId,
      status: "LISTO",
      salePrice: { $ne: null },
    })
      .select("variantId salePrice unitSale status updatedAt")
      .lean();

    const todayMap = new Map(); // variantId -> doc
    for (const d of todayDocs) todayMap.set(String(d.variantId), d);

    // 3) Historial: sacar últimos 2 precios LISTO por variante
    const variantIds = variants.map((v) => v._id);

    const hist = await DailyPrice.find({
      variantId: { $in: variantIds },
      status: "LISTO",
      salePrice: { $ne: null },
    })
      .select("variantId sessionId salePrice updatedAt")
      .sort({ updatedAt: -1 })
      .lean();

    const last2Map = new Map(); // variantId -> [p1, p2] (p1 más reciente)
    for (const d of hist) {
      const vId = String(d.variantId);
      if (!last2Map.has(vId)) last2Map.set(vId, []);
      const arr = last2Map.get(vId);
      if (arr.length >= 2) continue;
      arr.push(d);
    }

    // 4) Meta de sesiones necesarias (para dateKey del último precio)
    const neededSessionIds = new Set();
    for (const arr of last2Map.values()) {
      for (const x of arr) neededSessionIds.add(String(x.sessionId));
    }
    neededSessionIds.add(String(sessionId));

    const sessionsMeta = await PurchaseSession.find({ _id: { $in: Array.from(neededSessionIds) } })
      .select("_id dateKey dateTarget status")
      .lean();

    const sessMap = new Map(sessionsMeta.map((s) => [String(s._id), s]));

    // 5) Armar “pizarra”
    const rows = variants.map((v) => {
      const vId = String(v._id);
      const today = todayMap.get(vId) || null;

      // Si hay precio de hoy, ese es el efectivo.
      // Si no, usar último histórico (arr[0]) como vigente.
      const arr = last2Map.get(vId) || [];
      const last = arr[0] || null;
      const prev = arr[1] || null;

      const effectiveSalePrice = today?.salePrice ?? last?.salePrice ?? null;
      const eff = effectiveSalePrice == null ? null : Number(effectiveSalePrice);

      // movement/delta: SOLO para productos de HOY
      let movement = "NEW";
      let delta = null;

      if (today) {
        // precio anterior real: el primer histórico que NO sea de la misma sesión
        const pPrev = arr.find((x) => String(x.sessionId) !== String(sessionId)) || prev || null;
        const prevPrice = pPrev ? Number(pPrev.salePrice) : null;

        if (eff != null && prevPrice != null) {
          const d = eff - prevPrice;
          delta = d;
          if (d > 0) movement = "UP";
          else if (d < 0) movement = "DOWN";
          else movement = "SAME";
        } else {
          movement = "NEW";
          delta = null;
        }
      } else {
        // catálogo: neutral (sin flechas)
        movement = "NEW"; // si prefieres "=" cambia a "SAME"
        delta = null;
      }

      const lastSession = last ? sessMap.get(String(last.sessionId)) : null;

      return {
        // identidad / catálogo
        variantId: v._id,
        productId: v.productId?._id || null,
        productName: v.productId?.name || "Producto",
        category: v.productId?.category || "",
        nameVariant: v.nameVariant || "—",
        unitSale: v.unitSale || "KG",

        // flags
        isFromToday: Boolean(today),
        currentSession: {
          _id: currentSession._id,
          dateKey: currentSession.dateKey,
          status: currentSession.status,
        },

        // precio efectivo
        salePrice: eff,

        // vigencia
        lastDateKey: lastSession?.dateKey || null,

        // movimiento
        movement,
        delta,
      };
    });

    // Orden: primero los de hoy, luego por categoría/producto (estable)
    rows.sort((a, b) => {
      if (a.isFromToday !== b.isFromToday) return a.isFromToday ? -1 : 1;
      const ca = String(a.category || "").toLowerCase();
      const cb = String(b.category || "").toLowerCase();
      if (ca !== cb) return ca.localeCompare(cb);
      const pa = String(a.productName || "").toLowerCase();
      const pb = String(b.productName || "").toLowerCase();
      if (pa !== pb) return pa.localeCompare(pb);
      return String(a.nameVariant || "")
        .toLowerCase()
        .localeCompare(String(b.nameVariant || "").toLowerCase());
    });

    return res.json({ ok: true, rows });
  } catch (err) {
    console.error("listDailyPriceBoard error:", err);
    return res.status(500).json({
      ok: false,
      message: "Error listando pizarra de precios",
      error: err?.message || String(err),
    });
  }
}


module.exports = {
  listDailyPrices,
  getDailyPrice,
  listPendingPrices,
  setManualPrice,
  recalcSessionDailyPrices,
  listDailyPriceBoard,
};
