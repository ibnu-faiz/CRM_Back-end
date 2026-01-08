// src/routes/profile.routes.ts
import { Router } from 'express';
import * as profileController from '../controllers/profile.controller';
import * as notificationController from '../controllers/notification.controller'; // Import ini juga
import { authenticateToken } from '../middleware/auth.middleware';
import { uploadAvatarMiddleware } from '../middleware/upload.middleware'; 
import { updateAvatar } from '../controllers/profile.controller';

const router = Router();

router.use(authenticateToken);

// 1. GET Profile (Data User Login) -> Untuk useUser()
router.get('/', profileController.getMyProfile);

// 2. PATCH Preferences (Setting Notifikasi) -> Pindahkan route update setting kesini agar rapi
// Karena ini berhubungan dengan Profile User
router.patch('/notifications', notificationController.updatePreferences);

router.patch('/avatar', uploadAvatarMiddleware.single('avatar'), updateAvatar);

router.delete('/avatar', profileController.deleteAvatar);

export default router;