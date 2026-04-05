import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { Product } from '../models/Product.model';
import { AuthRequest } from '../types/AuthRequest';
import { cloudinaryService } from '../services/cloudinary.service';

/** Generate a URL-safe slug from a product name */
async function generateUniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  let slug = base;
  let counter = 1;
  while (true) {
    const query: Record<string, unknown> = { slug };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Product.findOne(query);
    if (!existing) break;
    slug = `${base}-${counter++}`;
  }
  return slug;
}

/** Strip falsy / empty-string fields from the body to avoid Mongoose cast errors */
function sanitizeProductBody(body: Record<string, unknown>) {
  const cleaned: Record<string, unknown> = { ...body };
  // Don't send empty string for ObjectId fields
  if (!cleaned.category || cleaned.category === '') delete cleaned.category;
  if (!cleaned.productCollection || cleaned.productCollection === '') delete cleaned.productCollection;
  return cleaned;
}

export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      limit = 12,
      collection,
      category,
      search,
      isFeatured,
      sort = 'newest',
    } = req.query;

    const filter: Record<string, unknown> = { isActive: true };

    if (collection) filter.productCollection = collection;
    if (category) filter.category = category;
    if (isFeatured === 'true') filter.isFeatured = true;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { shortDescription: { $regex: search, $options: 'i' } },
      ];
    }

    type SortQuery = [string, 1 | -1][];
    const sortMap: Record<string, SortQuery> = {
      newest: [['createdAt', -1]],
      price_asc: [['price', 1]],
      price_desc: [['price', -1]],
    };
    const sortQuery = sortMap[sort as string] || sortMap.newest;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Product.countDocuments(filter);
    const products = await Product.find(filter)
      .populate('category', 'name slug')
      .sort(sortQuery)
      .skip(skip)
      .limit(Number(limit));

    res.send({
      success: true,
      data: products,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getProductBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isActive: true }).populate(
      'category',
      'name slug'
    );
    if (!product) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Producto no encontrado' });
      return;
    }
    res.send({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const body = sanitizeProductBody(req.body);
    if (!body.slug) {
      body.slug = await generateUniqueSlug(String(body.name || ''));
    }
    const product = await Product.create(body);
    res.status(HttpStatusCode.Created).send({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const body = sanitizeProductBody(req.body);
    // Regenerate slug if name changed and no explicit slug provided
    if (body.name && !body.slug) {
      body.slug = await generateUniqueSlug(String(body.name), req.params.id as string);
    }
    const product = await Product.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!product) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Producto no encontrado' });
      return;
    }
    res.send({ success: true, data: product });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Producto no encontrado' });
      return;
    }

    // Delete all images from Cloudinary (fire-and-forget, don't block the response)
    const publicIds = product.images
      .map((url: string) => extractPublicId(url))
      .filter(Boolean) as string[];

    if (publicIds.length > 0) {
      Promise.all(publicIds.map((id) => cloudinaryService.deleteImage(id))).catch((e) =>
        console.warn('[deleteProduct] Cloudinary cleanup error:', e)
      );
    }

    await Product.findByIdAndUpdate(req.params.id, { isActive: false });
    res.send({ success: true, message: 'Producto eliminado' });
  } catch (error) {
    next(error);
  }
};

/**
 * Extract the Cloudinary public_id from a full secure_url.
 * e.g. https://res.cloudinary.com/dpjzfua3n/image/upload/v1234/sorbito-de-verdad/products/abc.jpg
 *   → sorbito-de-verdad/products/abc
 */
function extractPublicId(url: string): string | null {
  try {
    const match = url.match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z]+)?$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
