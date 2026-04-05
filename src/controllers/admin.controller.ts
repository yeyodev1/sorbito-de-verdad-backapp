import { HttpStatusCode } from 'axios';
import { Request, Response, NextFunction } from 'express';
import { User } from '../models/User.model';
import { Product } from '../models/Product.model';
import { Order } from '../models/Order.model';
import { Category } from '../models/Category.model';
import { AuthRequest } from '../types/AuthRequest';

// ---- Stats ----
export const getStats = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalProducts, totalOrders, totalUsers, totalCategories, recentOrders] =
      await Promise.all([
        Product.countDocuments({ isActive: true }),
        Order.countDocuments(),
        User.countDocuments({ isActive: true }),
        Category.countDocuments({ isActive: true }),
        Order.find().sort({ createdAt: -1 }).limit(5).populate('user', 'name email'),
      ]);

    const revenueAgg = await Order.aggregate([
      { $match: { paymentStatus: 'paid' } },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]);
    const totalRevenue = revenueAgg[0]?.total || 0;

    const pendingOrders = await Order.countDocuments({ status: 'pending' });

    res.send({
      success: true,
      data: {
        totalProducts,
        totalOrders,
        totalUsers,
        totalCategories,
        totalRevenue,
        pendingOrders,
        recentOrders,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ---- User Management (owner only) ----
export const getUsers = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.send({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

export const createAdminUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, email, password, role = 'admin' } = req.body;
    if (!name || !email || !password) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'Nombre, email y contraseña son requeridos' });
      return;
    }
    if (role === 'owner' && req.user?.accountType !== 'owner') {
      res.status(HttpStatusCode.Forbidden).send({ success: false, message: 'Solo el propietario puede crear otros propietarios' });
      return;
    }
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(HttpStatusCode.Conflict).send({ success: false, message: 'Email ya registrado' });
      return;
    }
    const user = await User.create({ name, email, password, role });
    const userObj = user.toObject();
    res.status(HttpStatusCode.Created).send({ success: true, data: { ...userObj, password: undefined } });
  } catch (error) {
    next(error);
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { role, isActive } = req.body;
    const update: Record<string, unknown> = {};
    if (role) update.role = role;
    if (typeof isActive === 'boolean') update.isActive = isActive;

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true }).select('-password');
    if (!user) {
      res.status(HttpStatusCode.NotFound).send({ success: false, message: 'Usuario no encontrado' });
      return;
    }
    res.send({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const deleteUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (req.params.id === req.user?.userId) {
      res.status(HttpStatusCode.BadRequest).send({ success: false, message: 'No puedes eliminar tu propia cuenta' });
      return;
    }
    await User.findByIdAndUpdate(req.params.id, { isActive: false });
    res.send({ success: true, message: 'Usuario desactivado' });
  } catch (error) {
    next(error);
  }
};
