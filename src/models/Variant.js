const mongoose = require("mongoose");

const variantSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },

    nameVariant: { type: String, required: true, trim: true },

    // ✅ Unidad de venta al público (precio del día se publica en esta unidad)
    unitSale: {
      type: String,
      enum: ["KG", "ATADO", "UNIDAD", "BANDEJA", "BOLSA"],
      default: "KG",
      trim: true,
    },

    // ✅ Unidad de compra sugerida (opcional)
    unitBuy: {
      type: String,
      enum: ["KG", "UNIDAD", "BOLSA", "CAJA", "FARDO", "ATADO"],
      default: "",
      trim: true,
    },

    /**
     * ✅ Conversión opcional (cuando compra != venta)
     * - Ej CAJA -> KG : conversion = kg_por_caja
     * - Ej FARDO -> ATADO : conversion = atados_por_fardo
     * Si está vacío => PENDIENTE (no se publica precio del día en AUTO si se necesita)
     */
    conversion: { type: Number, default: null, min: 0 },

    // Imagen propia (si existe, tiene prioridad)
    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

variantSchema.index({ productId: 1, nameVariant: 1 }, { unique: true });

module.exports = mongoose.model("Variant", variantSchema);
