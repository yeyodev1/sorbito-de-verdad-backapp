import { Router } from 'express';
import {
  getProducts,
  getProductBySlug,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/product.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const productRouter = Router();

productRouter.get('/', getProducts);
productRouter.get('/:slug', getProductBySlug);
productRouter.post('/', authMiddleware, createProduct);
productRouter.put('/:id', authMiddleware, updateProduct);
productRouter.delete('/:id', authMiddleware, deleteProduct);

export default productRouter;
