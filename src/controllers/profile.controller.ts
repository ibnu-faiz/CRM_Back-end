import { Request, Response } from 'express';
import prisma from '../config/database';
import fs from 'fs';
import path from 'path';

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.userId; // Dari middleware auth

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        // Sertakan field preferences ini:
        notifyLeadAssign: true,
        notifyLeadUpdate: true,
        notifyInvoice: true,
        notifyActivity: true,
        notifyNewLead: true,
        notifyDealStatus: true,
      }
    });

    if (!user) {
        return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

export const updateAvatar = async (req: Request, res: Response) => {
  try {
    // 1. Cek apakah ada file yang diupload?
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Ambil ID user dari Token (req.user)
    const userId = (req as any).user.userId;

    // 2. Cari data user lama untuk melihat foto profil sebelumnya
    const oldUser = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { avatar: true } 
    });

    // 3. LOGIKA HAPUS FOTO LAMA (Clean Up)
    if (oldUser?.avatar) {
      // Cek apakah avatar lama adalah file lokal (bukan link google/http)
      if (!oldUser.avatar.startsWith('http')) {
        // Susun path lengkap file lama di harddisk
        // oldUser.avatar isinya misal: "/uploads/avatars/avatar-123.jpg"
        const oldFilePath = path.join(process.cwd(), 'public', oldUser.avatar);

        // Hapus file jika ada
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath); 
        }
      }
    }

    // 4. Susun URL baru untuk disimpan di Database
    // Hasil: "/uploads/avatars/avatar-1709999.jpg"
    const newAvatarUrl = `/public/uploads/avatars/${req.file.filename}`;

    // 5. Update Database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatar: newAvatarUrl },
      select: { id: true, name: true, avatar: true, email: true }
    });

    res.json({
        message: "Avatar updated successfully",
        user: updatedUser
    });

  } catch (error) {
    console.error("Update Avatar Error:", error);
    // Jika error DB, hapus file yang barusan terlanjur diupload biar ga nyampah
    if (req.file) {
        fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to update avatar' });
  }
};

export const deleteAvatar = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    if (!user) return res.status(404).json({ error: "User not found" });

    // --- LOGIKA HAPUS YANG DIPERBAIKI ---
    if (user.avatar && !user.avatar.startsWith('http')) {
      
      // 1. Bersihkan path dari database
      // Hapus slash awal '/' agar path.join bekerja dengan benar dari root project
      // Jika di DB: "/public/uploads/..." -> jadi "public/uploads/..."
      const cleanDbPath = user.avatar.startsWith('/') ? user.avatar.slice(1) : user.avatar;
      
      // 2. Gabungkan dengan Root Project
      // Hasil: C:/Project/public/uploads/avatars/file.jpg
      const filePath = path.join(process.cwd(), cleanDbPath);

      // DEBUGGING: Cek di console server path mana yang sedang dihapus
      console.log("Mencoba menghapus file di:", filePath); 

      if (fs.existsSync(filePath)) {
         fs.unlinkSync(filePath);
         console.log("File berhasil dihapus dari server.");
      } else {
         console.log("File tidak ditemukan, skip delete.");
      }
    }
    // ------------------------------------

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatar: null },
      select: { id: true, name: true, avatar: true, email: true },
    });

    res.json({ message: "Avatar deleted successfully", user: updatedUser });

  } catch (error) {
    console.error("Delete Avatar Error:", error);
    res.status(500).json({ error: "Failed to delete avatar" });
  }
};

