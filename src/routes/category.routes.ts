import { Router } from 'express';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const categoryRouter = Router();

categoryRouter.get('/', getCategories);
categoryRouter.post('/', authMiddleware, createCategory);
categoryRouter.put('/:id', authMiddleware, updateCategory);
categoryRouter.delete('/:id', authMiddleware, deleteCategory);

export default categoryRouter;
