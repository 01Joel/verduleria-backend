const mongoose = require("mongoose");

const dailyPriceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PurchaseSession",
      required: true,
      index: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Variant",
      required: true,
      index: true,
    },

    unitSale: { type: String, default: "KG" },

    // costo final normalizado a la unidad de venta
    costFinal: { type: Number, default: null },

    marginPct: { type: Number, default: 0.35 },

    // precio de venta sugerido final (puede ser AUTO o MANUAL)
    salePrice: { type: Number, default: null },

    // Modo de pricing
    pricingMode: { type: String, enum: ["AUTO", "MANUAL"], default: "AUTO", index: true },

    // Si el admin fija manualmente un precio
    manualSalePrice: { type: Number, default: null },
    manualNote: { type: String, default: "" },
    manualSetBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    manualSetAt: { type: Date, default: null },

    status: {
      type: String,
      enum: ["PENDIENTE", "PARCIAL", "LISTO"],
      default: "PENDIENTE",
      index: true,
    },

    sourceLotId: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseLot", default: null },
  },
  { timestamps: true }
);

dailyPriceSchema.index({ sessionId: 1, variantId: 1 }, { unique: true });

module.exports = mongoose.model("DailyPrice", dailyPriceSchema);
