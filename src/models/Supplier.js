const mongoose = require("mongoose");

const supplierSchema = new mongoose.Schema(
  {
    nickname: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, trim: true, default: "" },
    lastname: { type: String, trim: true, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Supplier", supplierSchema);
