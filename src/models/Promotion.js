const mongoose = require("mongoose");

const promotionSchema = new mongoose.Schema(
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

    type: {
      type: String,
      enum: ["PERCENT_OFF", "BOGO"],
      required: true,
    },

    // PERCENT_OFF: 10, 20, 30, etc.
    percentOff: { type: Number, default: null },

    // BOGO: ej 2x1 => buyQty=2, payQty=1
    buyQty: { type: Number, default: null },
    payQty: { type: Number, default: null },

    startsAt: { type: Date, default: () => new Date() },
    endsAt: { type: Date, required: true },

    // Imagen promo (para diferenciar del producto normal)
    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },

    // Baja lógica / activación manual
    active: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

/**
 * Regla de simplicidad: 1 promo por (sessionId, variantId).
 * Si el admin crea otra, se actualiza la existente (upsert).
 */
promotionSchema.index({ sessionId: 1, variantId: 1 }, { unique: true });

module.exports = mongoose.model("Promotion", promotionSchema);
