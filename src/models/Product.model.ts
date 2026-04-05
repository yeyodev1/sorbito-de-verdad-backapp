import { Schema, model, Document, Types } from 'mongoose';

export interface IProductSize {
  name: string;   // e.g. 'Estándar', 'XXL'
  price: number;
}

export interface IProduct extends Document {
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: number;
  compareAtPrice?: number;
  sizes: IProductSize[];
  images: string[];
  mainImage: string;
  category: Types.ObjectId;
  productCollection: 'boscan' | 'moni' | 'rustica' | 'set';
  stock: number;
  allowBackorder: boolean;
  isActive: boolean;
  isFeatured: boolean;
  tags: string[];
  sku: string;
}

const productSchema = new Schema<IProduct>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true },
    description: { type: String, default: '' },
    shortDescription: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, min: 0 },
    sizes: [{
      name: { type: String, required: true },
      price: { type: Number, required: true, min: 0 },
    }],
    images: [{ type: String }],
    mainImage: { type: String, default: '' },
    category: { type: Schema.Types.ObjectId, ref: 'Category', default: undefined },
    productCollection: {
      type: String,
      enum: ['boscan', 'moni', 'rustica', 'set', ''],
      default: 'boscan',
    },
    stock: { type: Number, default: 0, min: 0 },
    allowBackorder: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    tags: [{ type: String }],
    sku: { type: String, required: true, unique: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// Virtual so frontend can read product.collection
productSchema.virtual('collection').get(function () {
  return this.productCollection;
});

productSchema.index({ name: 'text', description: 'text', shortDescription: 'text' });
productSchema.index({ productCollection: 1, isActive: 1 });
productSchema.index({ isFeatured: 1, isActive: 1 });

export const Product = model<IProduct>('Product', productSchema);
