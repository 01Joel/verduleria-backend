const mongoose = require("mongoose");

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    category: { type: String, trim: true, default: "" },

    // Imagen base (fallback para variantes)
    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },

    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Product", productSchema);
