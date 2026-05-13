import { Schema, model, Document, Types } from 'mongoose';

export interface IOrderItem {
  product: Types.ObjectId;
  name: string;
  image: string;
  quantity: number;
  price: number;
}

export interface IShippingAddress {
  name: string;
  phone: string;
  street: string;
  city: string;
  state?: string;
  country: string;
  zip?: string;
  mapsUrl?: string;
}

export interface IOrder extends Document {
  user: Types.ObjectId;
  orderNumber: string;
  items: IOrderItem[];
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  status: 'pending' | 'confirmed' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded';
  paymentMethod: string;
  shippingAddress: IShippingAddress;
  identificationNumber?: string;
  notes?: string;
  payphoneTransactionId?: string;
  clientTransactionId?: string;
  shippingZoneName?: string;
  guestTempPassword?: string;
  paymentReceiptUrl?: string;
  source?: string;
  payphoneLinkUrl?: string;
  payphoneLinkExpiresAt?: Date;
  remindersSent?: {
    r15min?: Date;
    r1h?: Date;
    r24h?: Date;
  };
  whatsappPhone?: string;
  createdAt: Date;
  updatedAt: Date;
}

const orderSchema = new Schema<IOrder>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    orderNumber: { type: String, unique: true },
    items: [
      {
        product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
        name: { type: String, required: true },
        image: { type: String },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true },
        sizeName: { type: String },
      },
    ],
    subtotal: { type: Number, required: true },
    shipping: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending',
    },
    paymentMethod: { type: String, default: 'manual' },
    shippingAddress: {
      name: { type: String, required: true },
      phone: { type: String },
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String },
      country: { type: String, required: true },
      zip: { type: String },
      mapsUrl: { type: String },
    },
    identificationNumber: { type: String },
    notes: { type: String },
    payphoneTransactionId: { type: String },
    clientTransactionId: { type: String },
    shippingZoneName: { type: String },
    guestTempPassword: { type: String },
    paymentReceiptUrl: { type: String },
    source: { type: String },
    payphoneLinkUrl: { type: String },
    payphoneLinkExpiresAt: { type: Date },
    remindersSent: {
      r15min: { type: Date },
      r1h: { type: Date },
      r24h: { type: Date },
    },
    whatsappPhone: { type: String },
  },
  { timestamps: true }
);

orderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    this.orderNumber = `SDV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  }
  next();
});

export const Order = model<IOrder>('Order', orderSchema);
