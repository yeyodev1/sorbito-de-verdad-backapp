import { Router } from 'express';
import { authMiddleware } from '../middlewares/auth.middleware';
import { requireAdmin, requireOwner } from '../middlewares/admin.middleware';
import { getStats, getUsers, createAdminUser, updateUserRole, deleteUser } from '../controllers/admin.controller';

const adminRouter = Router();

adminRouter.use(authMiddleware, requireAdmin);

// Stats (admin + owner)
adminRouter.get('/stats', getStats);

// User management (owner only)
adminRouter.get('/users', requireOwner, getUsers);
adminRouter.post('/users', requireOwner, createAdminUser);
adminRouter.patch('/users/:id', requireOwner, updateUserRole);
adminRouter.delete('/users/:id', requireOwner, deleteUser);

export default adminRouter;
