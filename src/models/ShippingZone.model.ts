import { Schema, model, Document } from 'mongoose';

export interface IShippingZone extends Document {
  name: string;
  description?: string;
  price: number;
  countries: string[];
  estimatedDays: string;
  mapsUrl?: string;
  isActive: boolean;
}

const shippingZoneSchema = new Schema<IShippingZone>(
  {
    name: { type: String, required: true },
    description: { type: String },
    price: { type: Number, required: true },
    countries: { type: [String], required: true },
    estimatedDays: { type: String, required: true },
    mapsUrl: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const ShippingZone = model<IShippingZone>('ShippingZone', shippingZoneSchema);
