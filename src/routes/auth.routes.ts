import { Router } from 'express';
import { register, login, getProfile, updateProfile, changePassword } from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import * as authController from '../controllers/auth.controller';

const router = Router();

router.post('/register', register);
router.post('/login', login);

router.get('/profile', authenticateToken, getProfile);
router.patch('/profile', authenticateToken, updateProfile);


router.post('/google-login', authController.googleLogin);         // Khusus Login page
router.post('/google-check', authController.googleRegisterCheck); // Khusus Register page

// --- Password Reset (INI YANG HILANG/ERROR) ---
router.post('/forgot-password', authController.forgotPassword); // <--- Pastikan ini ada
router.post('/reset-password', authController.resetPassword);   // <--- Pastikan ini ada
router.post('/change-password', authenticateToken, authController.changePassword);

export default router;