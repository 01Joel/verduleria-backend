const mongoose = require("mongoose");

const purchaseLotSchema = new mongoose.Schema(
  {
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseSession", required: true, index: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: "Variant", required: true, index: true },
    supplierId: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true, index: true },

    qty: { type: Number, required: true },
    unitCost: { type: Number, required: true },

    buyUnit: { type: String, index: true }, 

    netWeightKg: { type: Number, default: null },
    weighedAt: { type: Date, default: null },

    // ✅ NUEVO: pago / nota (Etapa 2)
    paymentMethod: {
      type: String,
      enum: ["EFECTIVO", "MERCADO_PAGO","NX", null],
      default: null,
      index: true,
    },
    paymentNote: { type: String, default: "" },

    boughtBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    boughtAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PurchaseLot", purchaseLotSchema);
