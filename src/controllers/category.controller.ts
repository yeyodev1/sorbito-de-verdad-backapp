import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { Category } from '../models/Category.model';
import { AuthRequest } from '../types/AuthRequest';

export const getCategories = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ name: 1 });
    res.send({ success: true, data: categories });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const category = await Category.create(req.body);
    res.status(HttpStatusCode.Created).send({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!category) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Categoría no encontrada' });
      return;
    }
    res.send({ success: true, data: category });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!['admin', 'owner'].includes(req.user?.accountType ?? '')) {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Sin permisos' });
      return;
    }
    const category = await Category.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!category) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Categoría no encontrada' });
      return;
    }
    res.send({ success: true, message: 'Categoría eliminada' });
  } catch (error) {
    next(error);
  }
};
