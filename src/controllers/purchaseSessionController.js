const PurchaseSession = require("../models/PurchaseSession");
const { toDateKeyAR, tomorrowStartAR, parseDateKeyToStartAR } = require("../utils/dateAR");
const { recalcAllDailyPricesForSession } = require("../services/pricingService");


async function createPurchaseSession(req, res) {
  // Permite crear para "mañana" por defecto o para una fecha específica.
  // Aceptamos: dateKey "YYYY-MM-DD" (recomendado) o dateTarget (ISO Date)
  const { dateKey, dateTarget } = req.body || {};

  let targetDate;
  if (dateKey) targetDate = parseDateKeyToStartAR(String(dateKey).trim());
  else if (dateTarget) targetDate = new Date(dateTarget);
  else targetDate = tomorrowStartAR();

  if (Number.isNaN(targetDate.getTime())) {
    return res.status(400).json({ ok: false, message: "Fecha inválida (dateKey o dateTarget)" });
  }

  const key = toDateKeyAR(targetDate);

  const exists = await PurchaseSession.findOne({ dateKey: key });
  if (exists) {
    return res.status(409).json({
      ok: false,
      message: `Ya existe una sesión para ${key}`,
      sessionId: exists._id,
    });
  }

  const session = await PurchaseSession.create({
    dateKey: key,
    dateTarget: targetDate,
    status: "PLANIFICACION",
    createdBy: req.user._id,
  });

  return res.status(201).json({ ok: true, session });
}

async function listPurchaseSessions(req, res) {
  const { status, from, to } = req.query;
  const filter = {};

  if (status) filter.status = status;

  // Filtro opcional por rango de dateKey: from/to en formato YYYY-MM-DD
  if (from || to) {
    filter.dateKey = {};
    if (from) filter.dateKey.$gte = String(from).trim();
    if (to) filter.dateKey.$lte = String(to).trim();
  }

  const sessions = await PurchaseSession.find(filter)
    .populate("createdBy", "username role")
    .sort({ dateKey: -1 });

  return res.json({ ok: true, sessions });
}

async function getPurchaseSession(req, res) {
  const session = await PurchaseSession.findById(req.params.id).populate("createdBy", "username role");
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });
  return res.json({ ok: true, session });
}

async function updatePurchaseSession(req, res) {
  // Solo permitimos cambiar fecha mientras está en PLANIFICACION
  const { dateKey, dateTarget } = req.body || {};
  const session = await PurchaseSession.findById(req.params.id);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar en PLANIFICACION" });
  }

  let targetDate;
  if (dateKey) targetDate = parseDateKeyToStartAR(String(dateKey).trim());
  else if (dateTarget) targetDate = new Date(dateTarget);
  else return res.status(400).json({ ok: false, message: "Debes enviar dateKey o dateTarget" });

  if (Number.isNaN(targetDate.getTime())) {
    return res.status(400).json({ ok: false, message: "Fecha inválida" });
  }

  const newKey = toDateKeyAR(targetDate);

  // Evitar choque con otra sesión
  const exists = await PurchaseSession.findOne({ dateKey: newKey, _id: { $ne: session._id } });
  if (exists) {
    return res.status(409).json({
      ok: false,
      message: `Ya existe una sesión para ${newKey}`,
      sessionId: exists._id,
    });
  }

  session.dateKey = newKey;
  session.dateTarget = targetDate;
  await session.save();

  return res.json({ ok: true, session });
}

async function openPurchaseSession(req, res) {
  const session = await PurchaseSession.findById(req.params.id);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "La sesión no está en PLANIFICACION" });
  }

  session.status = "ABIERTA";
  session.openedAt = new Date();
  await session.save();

  return res.json({ ok: true, session });
}

/*async function closePurchaseSession(req, res) {
  const session = await PurchaseSession.findById(req.params.id);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "ABIERTA") {
    return res.status(409).json({ ok: false, message: "La sesión no está ABIERTA" });
  }

  session.status = "CERRADA";
  session.closedAt = new Date();
  await session.save();

  return res.json({ ok: true, session });
}*/
async function closePurchaseSession(req, res) {
  const { id: sessionId } = req.params;

  // 1) Buscar sesión
  const session = await PurchaseSession.findById(sessionId);
  if (!session) {
    return res.status(404).json({ ok: false, message: "Sesión no encontrada" });
  }

  // 2) Validar estado
  if (session.status !== "ABIERTA") {
    return res.status(409).json({
      ok: false,
      message: "Solo se puede cerrar una sesión ABIERTA",
    });
  }

  // 3) Recalcular TODOS los precios del día (consolidación)
  await recalcAllDailyPricesForSession(sessionId);

  // 4) Cambiar estado + timestamp
  session.status = "CERRADA";
  session.closedAt = new Date();
  await session.save();

  // 5) Emitir socket a todos los que están en la sala de esa sesión
  const io = req.app.locals.io;
  if (io) {
    io.to(`session:${sessionId}`).emit("session_closed", {
      sessionId,
      closedAt: session.closedAt,
    });
  }

  // 6) Respuesta
  return res.json({ ok: true, session });
}
async function updateBudget(req, res) {
  const { id: sessionId } = req.params;
  const { plannedBudgetReal, plannedBudgetRef } = req.body || {};

  const session = await PurchaseSession.findById(sessionId);
  if (!session) return res.status(404).json({ ok: false, message: "Sesión no encontrada" });

  if (session.status !== "PLANIFICACION") {
    return res.status(409).json({ ok: false, message: "Solo se puede editar presupuesto en PLANIFICACION" });
  }

  if (plannedBudgetReal !== undefined) {
    const n = Number(plannedBudgetReal);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ ok: false, message: "plannedBudgetReal inválido" });
    }
    session.plannedBudgetReal = n;
  }

  // opcional (solo cache informativo)
  if (plannedBudgetRef !== undefined) {
    const n = Number(plannedBudgetRef);
    if (!Number.isFinite(n) || n < 0) {
      return res.status(400).json({ ok: false, message: "plannedBudgetRef inválido" });
    }
    session.plannedBudgetRef = n;
  }

  await session.save();
  return res.json({ ok: true, session });
}


module.exports = {
  createPurchaseSession,
  listPurchaseSessions,
  getPurchaseSession,
  updatePurchaseSession,
  openPurchaseSession,
  closePurchaseSession,
  updateBudget,
};
