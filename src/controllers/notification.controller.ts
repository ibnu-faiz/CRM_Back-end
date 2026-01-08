import { Request, Response } from "express";
import prisma from '../config/database';

// 1. GET: Ambil daftar notifikasi (Untuk Navbar)
export const getMyNotifications = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId; // Dari middleware auth

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20, // Ambil 20 terakhir saja biar ringan
    });

    // Hitung yang belum dibaca
    const unreadCount = await prisma.notification.count({
      where: { userId, isRead: false },
    });

    res.json({ notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil notifikasi" });
  }
};

// 2. PATCH: Tandai sudah dibaca (Saat user klik lonceng/buka list)
export const markAsRead = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    
    // Update semua notif user ini jadi 'read'
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    res.json({ message: "All marked as read" });
  } catch (error) {
    res.status(500).json({ error: "Error marking read" });
  }
};

// 3. PATCH: Update Setting Preferensi (Untuk Halaman Profile)
export const updatePreferences = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId;
    const body = req.body; // Isinya: { notifyLeadAssign: false, ... }

    // Validasi sederhana: Pastikan hanya field preference yang boleh diupdate
    const allowedFields = [
      "notifyLeadAssign", "notifyLeadUpdate", "notifyInvoice", 
      "notifyActivity", "notifyNewLead", "notifyDealStatus"
    ];
    
    const dataToUpdate: any = {};
    for (const key of allowedFields) {
        if (body[key] !== undefined) {
            dataToUpdate[key] = body[key];
        }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: dataToUpdate,
      select: { 
          id: true, notifyLeadAssign: true, notifyLeadUpdate: true, 
          // ... select field lain buat dikembalikan ke frontend
      } 
    });

    res.json(updatedUser);
  } catch (error) {
    res.status(500).json({ error: "Gagal update setting" });
  }
};