import { Schema, model, Document } from 'mongoose';

export interface ITempCart extends Document {
  phone: string;
  data: {
    customerName?: string;
    customerEmail?: string;
    identificationNumber?: string;
    address?: string;
    city?: string;
    country?: string;
    productDescription?: string;
    productsCount?: number;
    productSubtotal?: number;
    shippingCost?: number;
    total?: number;
  };
  updatedAt: Date;
  createdAt: Date;
}

const tempCartSchema = new Schema<ITempCart>(
  {
    phone: { type: String, required: true, unique: true, index: true },
    data: {
      customerName: String,
      customerEmail: String,
      identificationNumber: String,
      address: String,
      city: String,
      country: String,
      productDescription: String,
      productsCount: Number,
      productSubtotal: Number,
      shippingCost: Number,
      total: Number,
    },
  },
  { timestamps: true }
);

// TTL: docs auto-delete 2h after last update
tempCartSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7200 });

export const TempCart = model<ITempCart>('TempCart', tempCartSchema);
