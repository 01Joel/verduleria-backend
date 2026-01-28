const mongoose = require("mongoose");

const purchaseSessionSchema = new mongoose.Schema(
  {
    // Clave única por día en TZ Argentina (YYYY-MM-DD)
    dateKey: { type: String, required: true, unique: true, index: true },

    // Fecha objetivo (se guarda como Date, pero se controla por dateKey)
    dateTarget: { type: Date, required: true },

    status: {
      type: String,
      enum: ["PLANIFICACION", "ABIERTA", "CERRADA"],
      default: "PLANIFICACION",
      index: true,
    },
    plannedBudgetRef: { type: Number, default: null },
    plannedBudgetReal: { type: Number, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    openedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PurchaseSession", purchaseSessionSchema);
