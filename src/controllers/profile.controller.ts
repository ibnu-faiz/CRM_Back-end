// src/controllers/profile.controller.ts
import { Request, Response } from 'express';
import prisma from '../config/database';
import { deleteFileFromCloudinary } from '../utils/cloudinary';

export const getMyProfile = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,      // Tambahkan ini
        location: true,   // Tambahkan ini
        bio: true,        // Tambahkan ini
        skills: true,     // Tambahkan ini
        department: true, // Tambahkan ini
        role: true,
        avatar: true,
        joinedAt: true,   // Tambahkan ini (buat display joined date)
        createdAt: true,  // Tambahkan ini
        
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
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const userId = (req as any).user.userId;
    
    // Cari Avatar Lama
    const oldUser = await prisma.user.findUnique({ 
        where: { id: userId },
        select: { avatar: true } 
    });

    // Hapus Avatar Lama di Cloudinary
    if (oldUser?.avatar) {
        await deleteFileFromCloudinary(oldUser.avatar);
    }
    
    const newAvatarUrl = req.file.path; 

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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true },
    });

    if (user?.avatar) {
       await deleteFileFromCloudinary(user.avatar);
    }

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