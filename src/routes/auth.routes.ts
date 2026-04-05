import { Router } from 'express';
import { login, register, getMe, forgotPassword, resetPassword, changePassword } from '../controllers/auth.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const authRouter = Router();

authRouter.post('/register', register);
authRouter.post('/login', login);
authRouter.get('/me', authMiddleware, getMe);
authRouter.post('/forgot-password', forgotPassword);
authRouter.post('/reset-password', resetPassword);
authRouter.post('/change-password', authMiddleware, changePassword);

export default authRouter;
