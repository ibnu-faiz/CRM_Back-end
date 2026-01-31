// src/routes/profile.routes.ts
import { Router } from 'express';
import * as profileController from '../controllers/profile.controller';
import * as notificationController from '../controllers/notification.controller'; 
import { authenticateToken } from '../middleware/auth.middleware';
import { uploadAvatarMiddleware } from '../middleware/upload.middleware'; 

const router = Router();

// Semua route di bawah ini butuh login
router.use(authenticateToken);

// 1. GET Profile (Ambil Data User)
router.get('/', profileController.getMyProfile);

// 3. PATCH Preferences (Setting Notifikasi)
router.patch('/notifications', notificationController.updatePreferences);

// 4. Avatar Management (Upload & Delete)
// Saya rapikan import-nya pakai profileController.* biar konsisten
router.patch('/avatar', uploadAvatarMiddleware.single('avatar'), profileController.updateAvatar);
router.delete('/avatar', profileController.deleteAvatar);

export default router;