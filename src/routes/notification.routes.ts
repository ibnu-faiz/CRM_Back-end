// src/routes/notification.routes.ts
import { Router } from 'express';
import * as notificationController from '../controllers/notification.controller';
import { authenticateToken } from '../middleware/auth.middleware';

const router = Router();

// Terapkan middleware auth untuk semua route notifikasi
// (Karena notifikasi bersifat privat per user)
router.use(authenticateToken);

// 1. GET /api/notifications
// Mengambil list notifikasi & jumlah unread
router.get('/', notificationController.getMyNotifications);

// 2. PATCH /api/notifications/read
// Menandai semua notifikasi sebagai "Sudah Dibaca" (saat klik lonceng)
router.patch('/read', notificationController.markAsRead);

// 3. PATCH /api/notifications/preferences
// Mengupdate setting (on/off) notifikasi di halaman Profile
router.patch('/preferences', notificationController.updatePreferences);

export default router;