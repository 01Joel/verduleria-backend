const PurchaseSession = require("../models/PurchaseSession");

async function getCurrentSession(req, res) {
  // 1) ABIERTA
  let session = await PurchaseSession.findOne({ status: "ABIERTA" }).sort({ createdAt: -1 });

  // 2) PLANIFICACION
  if (!session) {
    session = await PurchaseSession.findOne({ status: "PLANIFICACION" }).sort({ createdAt: -1 });
  }

  // 3) última
  if (!session) {
    session = await PurchaseSession.findOne().sort({ createdAt: -1 });
  }

  if (!session) {
    return res.status(404).json({ ok: false, message: "No hay sesiones" });
  }

  return res.json({
    ok: true,
    session: {
      _id: String(session._id),
      dateKey: session.dateKey,
      status: session.status,
      openedAt: session.openedAt || null,
      closedAt: session.closedAt || null,
    },
  });
}

module.exports = { getCurrentSession };
