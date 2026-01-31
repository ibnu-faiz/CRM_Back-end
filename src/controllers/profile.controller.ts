import { Request, Response } from 'express';
import prisma from '../config/database';
import { deleteFileFromCloudinary } from '../utils/cloudinary';

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId; // Casting any biar aman

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
        // Sertakan field preferences:
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

    // Ambil ID user dari Token
    const userId = (req as any).user.userId;
    
    // 2. 🔥 CARI AVATAR LAMA DI DATABASE 🔥
    // Kita butuh URL lama untuk dihapus dari Cloudinary
    const oldUser = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { avatar: true } 
    });

    // 3. 🔥 JIKA ADA AVATAR LAMA, HAPUS DARI CLOUDINARY 🔥
    if (oldUser?.avatar) {
        await deleteFileFromCloudinary(oldUser.avatar);
    }
    
    // 4. Ambil URL Baru dari Cloudinary
    const newAvatarUrl = req.file.path; 

    // 5. Update Database dengan URL Baru
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
    res.status(500).json({ error: 'Failed to update avatar' });
  }
};

export const deleteAvatar = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // 1. 🔥 AMBIL DATA USER UNTUK DAPAT URL AVATAR 🔥
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    // 2. 🔥 HAPUS FILE DI CLOUDINARY (JIKA ADA) 🔥
    if (user?.avatar) {
       await deleteFileFromCloudinary(user.avatar);
    }

    // 3. Update Database (Set NULL)
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