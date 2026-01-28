const mongoose = require("mongoose");

const purchaseSessionItemSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseSession", required: true, index: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: "Variant", required: true, index: true },

    origin: { type: String, enum: ["PLANIFICADO", "NO_PLANIFICADO"], default: "PLANIFICADO" },

    plannedQty: { type: Number, default: null },
    refPrice: { type: Number, default: null },   
    refBuyUnit: { type: String, enum: ["KG", "CAJA", "ATADO", "UNIDAD", "BOLSA"], default: null, set: (v) => String(v || "").trim().toUpperCase(),},

    state: {
      type: String,
      enum: ["PENDIENTE", "RESERVADO", "COMPRADO", "CANCELADO"],
      default: "PENDIENTE",
      index: true,
    },

    reservedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    reserveExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Evitar duplicados: una variante solo una vez por sesión
purchaseSessionItemSchema.index({ sessionId: 1, variantId: 1 }, { unique: true });

module.exports = mongoose.model("PurchaseSessionItem", purchaseSessionItemSchema);
